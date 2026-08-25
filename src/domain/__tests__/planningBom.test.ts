import { describe, expect, it } from 'vitest';
import { MAX_BOM_DEPTH } from '../impactAnalysis';
import { explodePlanningBom } from '../planningBom';
import type { PlmBomLine, PlmItem } from '../types';

function woodenChairMbom(): PlmBomLine[] {
  return [
    { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-3', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'FG-100', childItemId: 'PT-500', qtyPer: 8, bomLineId: 'M-4', bomType: 'M', version: 1, effectiveFromDay: 0 },
  ];
}

const woodenChairItems: PlmItem[] = [
  { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産', salesPrice: 6000 },
  { itemId: 'SA-200', name: '座面ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
  { itemId: 'RM-300', name: '木板', makeBuy: 'BUY', leadTimeDays: 5, lifecycleStatus: '量産', purchasePrice: 800 },
  { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 250 },
  { itemId: 'PT-401', name: '脚（代替品B）', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 220 },
  { itemId: 'PT-500', name: 'ネジ', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 20 },
];

// 4.2: 自転車（4階層BOM）。FG-700(LT2) -> SA-710(LT1) -> SA-720(LT1) -> RM-730(LT3)、FG-700 -> PT-740(LT3)。
function bicycleMbom(): PlmBomLine[] {
  return [
    { parentItemId: 'FG-700', childItemId: 'SA-710', qtyPer: 2, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'SA-710', childItemId: 'SA-720', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'SA-720', childItemId: 'RM-730', qtyPer: 1, bomLineId: 'M-3', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'FG-700', childItemId: 'PT-740', qtyPer: 1, bomLineId: 'M-4', bomType: 'M', version: 1, effectiveFromDay: 0 },
  ];
}

const bicycleItems: PlmItem[] = [
  { itemId: 'FG-700', name: '自転車', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産', salesPrice: 15000 },
  { itemId: 'SA-710', name: '車輪ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
  { itemId: 'SA-720', name: 'リムASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
  { itemId: 'RM-730', name: 'アルミリム材', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 300 },
  { itemId: 'PT-740', name: 'フレーム', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 4000 },
];

describe('explodePlanningBom (計画BOM、Issue #9)', () => {
  it('computes startByDay as targetNeedDay minus cumulative lead time for a 2-level BOM', () => {
    const results = explodePlanningBom('FG-100', 1, 100, 0, woodenChairMbom(), woodenChairItems);

    const top = results.find((r) => r.itemId === 'FG-100')!;
    expect(top.needByDay).toBe(100);
    expect(top.startByDay).toBe(100 - 2); // 98

    const seatAssy = results.find((r) => r.itemId === 'SA-200')!;
    expect(seatAssy.needByDay).toBe(98);
    expect(seatAssy.startByDay).toBe(98 - 1); // 97

    const board = results.find((r) => r.itemId === 'RM-300')!;
    // 累積リードタイム: FG-100(2) + SA-200(1) + RM-300(5) = 8
    expect(board.startByDay).toBe(100 - 8);

    const leg = results.find((r) => r.itemId === 'PT-400')!;
    // 累積リードタイム: FG-100(2) + PT-400(3) = 5
    expect(leg.startByDay).toBe(100 - 5);
    expect(leg.qtyRequired).toBe(4);
  });

  it('accumulates lead time correctly through a 4-level bicycle BOM', () => {
    const results = explodePlanningBom('FG-700', 1, 200, 0, bicycleMbom(), bicycleItems);

    const rim = results.find((r) => r.itemId === 'RM-730')!;
    // 累積リードタイム: FG-700(2) + SA-710(1) + SA-720(1) + RM-730(3) = 7
    expect(rim.startByDay).toBe(200 - 7);
    // 累積必要数: 2(SA-710) * 1(SA-720) * 1(RM-730) = 2
    expect(rim.qtyRequired).toBe(2);

    const frame = results.find((r) => r.itemId === 'PT-740')!;
    expect(frame.startByDay).toBe(200 - (2 + 3));
    expect(frame.qtyRequired).toBe(1);
  });

  it('resolves alternate parts groups so only the chosen candidate is counted once', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
      {
        parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0,
        alternateGroupId: 'AG-LEG', alternatePriority: 1, approvalStatus: '承認済',
      },
      {
        parentItemId: 'FG-100', childItemId: 'PT-401', qtyPer: 4, bomLineId: 'M-3', bomType: 'M', version: 1, effectiveFromDay: 0,
        alternateGroupId: 'AG-LEG', alternatePriority: 2, approvalStatus: '承認済',
      },
    ];

    const defaultResult = explodePlanningBom('FG-100', 1, 100, 0, bomLines, woodenChairItems);
    expect(defaultResult.filter((r) => r.itemId === 'PT-400')).toHaveLength(1);
    expect(defaultResult.filter((r) => r.itemId === 'PT-401')).toHaveLength(0);

    const overriddenResult = explodePlanningBom('FG-100', 1, 100, 0, bomLines, woodenChairItems, { 'AG-LEG': 'PT-401' });
    expect(overriddenResult.filter((r) => r.itemId === 'PT-401')).toHaveLength(1);
    expect(overriddenResult.filter((r) => r.itemId === 'PT-400')).toHaveLength(0);
  });

  it('reflects a future BOM revision only once asOfDay reaches its effectiveFromDay', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0, effectiveToDay: 50 },
      { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 6, bomLineId: 'M-1-v2', bomType: 'M', version: 2, effectiveFromDay: 50 },
    ];

    const before = explodePlanningBom('FG-100', 1, 100, 10, bomLines, woodenChairItems);
    expect(before.find((r) => r.itemId === 'PT-400')?.qtyRequired).toBe(4);

    const after = explodePlanningBom('FG-100', 1, 100, 60, bomLines, woodenChairItems);
    expect(after.find((r) => r.itemId === 'PT-400')?.qtyRequired).toBe(6);
  });

  it('rejects a topItemId whose E-BOM has not yet been converted to M-BOM', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'E-1', bomType: 'E', version: 1, effectiveFromDay: 0 },
    ];
    expect(() => explodePlanningBom('FG-100', 1, 100, 0, bomLines, woodenChairItems)).toThrow(/M-BOM/);
  });

  it('throws once BOM depth exceeds MAX_BOM_DEPTH on a genuinely deep (non-cyclic) chain', () => {
    const bomLines: PlmBomLine[] = [];
    for (let i = MAX_BOM_DEPTH + 2; i > 0; i--) {
      bomLines.push({
        parentItemId: `L${i}`,
        childItemId: `L${i - 1}`,
        qtyPer: 1,
        bomLineId: `M-${i}`,
        bomType: 'M',
        version: 1,
        effectiveFromDay: 0,
      });
    }
    expect(() => explodePlanningBom(`L${MAX_BOM_DEPTH + 2}`, 1, 1000, 0, bomLines, [])).toThrow(/深さ上限/);
  });

  it('terminates on circular BOM data instead of looping forever', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'A', childItemId: 'B', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'B', childItemId: 'A', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    expect(() => explodePlanningBom('A', 1, 100, 0, bomLines, [])).not.toThrow();
  });
});

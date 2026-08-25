import { describe, expect, it } from 'vitest';
import { MAX_BOM_DEPTH, computeCostImpact, computeRolledUpCost, whereUsed } from '../impactAnalysis';
import type { EngineeringChange, PlmBomLine, PlmItem } from '../types';

function woodenChairMbom(): PlmBomLine[] {
  return [
    { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-3', bomType: 'M', version: 1, effectiveFromDay: 0 },
    { parentItemId: 'FG-100', childItemId: 'PT-500', qtyPer: 8, bomLineId: 'M-4', bomType: 'M', version: 1, effectiveFromDay: 0 },
  ];
}

describe('whereUsed (7.1)', () => {
  // UC-IMPACT-1
  it('finds all ancestors of a deep leaf item (RM-300 -> SA-200 -> FG-100)', () => {
    const results = whereUsed('RM-300', woodenChairMbom(), 'M', 0);
    const parents = results.map((r) => r.parentItemId);
    expect(parents).toContain('SA-200');
    expect(parents).toContain('FG-100');
  });

  // UC-EBOM-4
  it('throws once BOM depth exceeds MAX_BOM_DEPTH on a genuinely deep (non-cyclic) chain', () => {
    const bomLines: PlmBomLine[] = [];
    // 22階層の一直線チェーン: L21 -> L20 -> ... -> L0
    for (let i = 0; i < MAX_BOM_DEPTH + 2; i++) {
      bomLines.push({
        parentItemId: `L${i + 1}`,
        childItemId: `L${i}`,
        qtyPer: 1,
        bomLineId: `M-${i}`,
        bomType: 'M',
        version: 1,
        effectiveFromDay: 0,
      });
    }
    expect(() => whereUsed('L0', bomLines, 'M', 0)).toThrow(/深さ上限/);
  });

  // UC-IMPACT-2
  it('terminates on circular BOM data instead of looping forever', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'B', childItemId: 'A', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'A', childItemId: 'B', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    expect(() => whereUsed('A', bomLines, 'M', 0)).not.toThrow();
  });

  it('respects effectiveFromDay/effectiveToDay when filtering ancestors', () => {
    const bomLines = woodenChairMbom();
    bomLines[2].effectiveFromDay = 100; // PT-400の使用開始をD+100からに変更
    const before = whereUsed('PT-400', bomLines, 'M', 0);
    const after = whereUsed('PT-400', bomLines, 'M', 150);
    expect(before).toHaveLength(0);
    expect(after.map((r) => r.parentItemId)).toContain('FG-100');
  });
});

describe('cost impact (7.7)', () => {
  const items: PlmItem[] = [
    { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産', salesPrice: 6000 },
    { itemId: 'SA-200', name: '座面ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
    { itemId: 'RM-300', name: '木板', makeBuy: 'BUY', leadTimeDays: 5, lifecycleStatus: '量産', purchasePrice: 800 },
    { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 250 },
    { itemId: 'PT-401', name: '脚（代替品B）', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 220 },
    { itemId: 'PT-500', name: 'ネジ', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 20 },
  ];

  it('rolls up BUY item purchase cost through MAKE parents', () => {
    // SA-200: 800*1 = 800 / FG-100: SA-200(800) + PT-400*4(1000) + PT-500*8(160) = 1960
    expect(computeRolledUpCost('SA-200', woodenChairMbom(), items)).toBe(800);
    expect(computeRolledUpCost('FG-100', woodenChairMbom(), items)).toBe(1960);
  });

  // UC-IMPACT-4
  it('computes the before/after cost delta when a BOM line changes (leg swapped to the cheaper alternate)', () => {
    const before = woodenChairMbom();
    const after = woodenChairMbom();
    after[2] = { ...after[2], childItemId: 'PT-401' };

    const change: EngineeringChange = {
      changeId: 'ECO-1',
      type: 'ECO',
      status: 'ECO発行',
      reason: 'コスト削減',
      changeLevel: '軽微',
      impactedItemIds: ['FG-100'],
      impactedBomLineIds: [],
      approvals: [],
    };

    const [impact] = computeCostImpact(change, before, after, items);
    expect(impact.before).toBe(1960);
    expect(impact.after).toBe(1960 - (250 - 220) * 4);
    expect(impact.delta).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveAlternates } from '../mbom';
import {
  MAX_BOM_DEPTH,
  assertMbomConverted,
  buildPurchaseBom,
  computeCostImpact,
  computeRolledUpCost,
  summarizePurchaseBomBySupplier,
  whereUsed,
} from '../impactAnalysis';
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

describe('buildPurchaseBom (発注BOM、Issue #8)', () => {
  const items: PlmItem[] = [
    { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産', salesPrice: 6000 },
    { itemId: 'SA-200', name: '座面ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
    { itemId: 'RM-300', name: '木板', makeBuy: 'BUY', leadTimeDays: 5, lifecycleStatus: '量産', purchasePrice: 800, defaultSupplierId: 'SUP-1' },
    { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 250, defaultSupplierId: 'SUP-2' },
    { itemId: 'PT-401', name: '脚（代替品B）', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 220, defaultSupplierId: 'SUP-3' },
    { itemId: 'PT-500', name: 'ネジ', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 20 }, // 既定仕入先未設定
  ];

  it('includes only BUY items, excluding MAKE intermediates', () => {
    const result = buildPurchaseBom('FG-100', woodenChairMbom(), items, 0);
    const itemIds = result.map((r) => r.itemId);
    expect(itemIds).toEqual(expect.arrayContaining(['RM-300', 'PT-400', 'PT-500']));
    expect(itemIds).not.toContain('FG-100');
    expect(itemIds).not.toContain('SA-200');
  });

  it('multiplies qtyPer through intermediate levels for a 4-level bicycle BOM', () => {
    const bicycleMbom: PlmBomLine[] = [
      { parentItemId: 'FG-700', childItemId: 'SA-710', qtyPer: 2, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'SA-710', childItemId: 'SA-720', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'SA-720', childItemId: 'RM-730', qtyPer: 1, bomLineId: 'M-3', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'FG-700', childItemId: 'PT-740', qtyPer: 1, bomLineId: 'M-4', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    const bicycleItems: PlmItem[] = [
      { itemId: 'FG-700', name: '自転車', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産', salesPrice: 15000 },
      { itemId: 'SA-710', name: '車輪ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
      { itemId: 'SA-720', name: 'リムASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' },
      { itemId: 'RM-730', name: 'アルミリム材', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 300, defaultSupplierId: 'SUP-1' },
      { itemId: 'PT-740', name: 'フレーム', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産', purchasePrice: 4000, defaultSupplierId: 'SUP-2' },
    ];
    const result = buildPurchaseBom('FG-700', bicycleMbom, bicycleItems, 0);
    // 車輪ASSY x2 * リムASSY x1 * アルミリム材 x1 = 2
    expect(result.find((r) => r.itemId === 'RM-730')?.totalQtyPer).toBe(2);
    expect(result.find((r) => r.itemId === 'PT-740')?.totalQtyPer).toBe(1);
  });

  it('flags BUY items with no defaultSupplierId as supplierMissing', () => {
    const result = buildPurchaseBom('FG-100', woodenChairMbom(), items, 0);
    expect(result.find((r) => r.itemId === 'PT-500')?.supplierMissing).toBe(true);
    expect(result.find((r) => r.itemId === 'RM-300')?.supplierMissing).toBe(false);
  });

  it('does not double-count an alternate parts group once resolved to a single choice', () => {
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
    // effectiveMbomLines(state)相当：呼び出し側が代替部品を解決してから渡す
    const resolved = resolveAlternates(bomLines);
    const result = buildPurchaseBom('FG-100', resolved, items, 0);
    expect(result.filter((r) => r.itemId === 'PT-400')).toHaveLength(1);
    expect(result.filter((r) => r.itemId === 'PT-401')).toHaveLength(0);
  });

  it('aggregates a BUY item used via multiple paths into a single merged row', () => {
    const bomLines: PlmBomLine[] = [
      ...woodenChairMbom(),
      // PT-500（ネジ）をSA-200からも直接使う（ダイヤモンド構造）
      { parentItemId: 'SA-200', childItemId: 'PT-500', qtyPer: 2, bomLineId: 'M-5', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    const result = buildPurchaseBom('FG-100', bomLines, items, 0);
    const screwRows = result.filter((r) => r.itemId === 'PT-500');
    expect(screwRows).toHaveLength(1);
    // FG-100直下 x8 + SA-200経由 x1(SA-200) * 2 = 8 + 2 = 10
    expect(screwRows[0].totalQtyPer).toBe(10);
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
    expect(() => buildPurchaseBom(`L${MAX_BOM_DEPTH + 2}`, bomLines, [], 0)).toThrow(/深さ上限/);
  });

  it('terminates on circular BOM data instead of looping forever', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'A', childItemId: 'B', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
      { parentItemId: 'B', childItemId: 'A', qtyPer: 1, bomLineId: 'M-2', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    expect(() => buildPurchaseBom('A', bomLines, [], 0)).not.toThrow();
  });

  it('summarizes purchase BOM lines by supplier', () => {
    const result = buildPurchaseBom('FG-100', woodenChairMbom(), items, 0);
    const summary = summarizePurchaseBomBySupplier(result);
    const sup2 = summary.find((s) => s.supplierId === 'SUP-2'); // PT-400のみ（SUP-2、PT-500は未設定なので別グループ）
    expect(sup2?.totalQty).toBe(4);
    expect(sup2?.totalCost).toBe(250 * 4);
  });

  // isEffectiveAsOf()による有効日フィルタが機能することを、旧版化された行を含む
  // 生のM-BOM行（currentMbomLinesを経由しない）に対して直接検証する。
  it('respects effectiveFromDay/effectiveToDay when asOfDay is in the past', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0, effectiveToDay: 50 },
      { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 6, bomLineId: 'M-1-v2', bomType: 'M', version: 2, effectiveFromDay: 50 },
    ];
    const before = buildPurchaseBom('FG-100', bomLines, items, 10);
    expect(before.find((r) => r.itemId === 'PT-400')?.totalQtyPer).toBe(4);

    const after = buildPurchaseBom('FG-100', bomLines, items, 60);
    expect(after.find((r) => r.itemId === 'PT-400')?.totalQtyPer).toBe(6);
  });
});

describe('assertMbomConverted (発注BOM・計画BOM共通の前提チェック)', () => {
  it('rejects a topItemId whose E-BOM has not yet been converted to M-BOM', () => {
    const bomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'E-1', bomType: 'E', version: 1, effectiveFromDay: 0 },
    ];
    expect(() => assertMbomConverted('FG-100', bomLines)).toThrow(/M-BOM/);
  });

  it('accepts a topItemId whose M-BOM already exists', () => {
    expect(() => assertMbomConverted('FG-100', woodenChairMbom())).not.toThrow();
  });

  it('accepts a leaf item with no BOM lines at all', () => {
    expect(() => assertMbomConverted('PT-400', woodenChairMbom())).not.toThrow();
  });
});

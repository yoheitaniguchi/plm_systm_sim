// コンベア装置プリセット（design.md PLM-EXT-15）の検証。
import { describe, expect, it } from 'vitest';
import { currentEbomLines } from '../ebom';
import { buildPurchaseBom, computeRolledUpCost, whereUsed } from '../impactAnalysis';
import { assertSnapshotUsable, parseMasterSnapshot } from '../masterSnapshot';
import { currentMbomLines } from '../mbom';
import { explodePlanningBom } from '../planningBom';
import { bicycleMasterSnapshot, conveyorMasterSnapshot, woodenChairMasterSnapshot } from '../presets';
import { createInitialState, reducer } from '../reducer';
import type { AppState } from '../reducer';

function importConveyor(): AppState {
  return reducer(createInitialState(), { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
}

function importAndConvert(): AppState {
  return reducer(importConveyor(), { type: 'mbom/convert', effectiveFromDay: 0 });
}

describe('conveyor preset (PLM-EXT-15)', () => {
  it('passes the two-layer MasterSnapshot validation (schema, duplicate keys, cycles, references)', () => {
    const parsed = parseMasterSnapshot(JSON.parse(JSON.stringify(conveyorMasterSnapshot)));
    expect(() => assertSnapshotUsable(parsed)).not.toThrow();
  });

  it('follows the item code convention and does not collide with the other presets', () => {
    const ids = conveyorMasterSnapshot.items.map((i) => i.itemId);
    for (const id of ids) expect(id).toMatch(/^(FG|SA|RM|PT)-8\d0$/);
    const others = new Set([...woodenChairMasterSnapshot.items, ...bicycleMasterSnapshot.items].map((i) => i.itemId));
    expect(ids.filter((id) => others.has(id))).toEqual([]);
  });

  it('gives every BUY item a price and a supplier that exists in the snapshot', () => {
    const supplierIds = new Set(conveyorMasterSnapshot.suppliers.map((s) => s.supplierId));
    for (const item of conveyorMasterSnapshot.items.filter((i) => i.makeBuy === 'BUY')) {
      expect(item.purchasePrice).toBeGreaterThan(0);
      expect(supplierIds.has(item.defaultSupplierId ?? '')).toBe(true);
    }
  });

  it('leaves routing steps and work centers empty (handled by the BOP/BOR extension)', () => {
    expect(conveyorMasterSnapshot.routingSteps).toEqual([]);
    expect(conveyorMasterSnapshot.workCenters).toEqual([]);
  });

  it('imports via sync/import as a 3-level E-BOM with all items in 量産', () => {
    const state = importConveyor();
    expect(state.lastError).toBeNull();
    expect(state.items).toHaveLength(9);
    expect(state.items.every((i) => i.lifecycleStatus === '量産')).toBe(true);
    const ebom = currentEbomLines(state.bomLines);
    expect(ebom).toHaveLength(10);
    expect(ebom.filter((l) => l.parentItemId === 'FG-800').map((l) => l.childItemId)).toEqual(['SA-810', 'SA-820', 'SA-830']);
  });

  it('returns three direct parents for the shared bolt in where-used, and the top item above them', () => {
    const state = importConveyor();
    const results = whereUsed('PT-880', state.bomLines, 'E', 0);
    const directParents = results.filter((r) => r.depth === 1).map((r) => r.parentItemId);
    expect(directParents.sort()).toEqual(['SA-810', 'SA-820', 'SA-830']);
    // whereUsed()は上位の同じ品目を経路の数だけ返す（7.1の疑似コードどおり）。画面側で重複を除く（PLM-EXT-15）
    expect(results.filter((r) => r.depth === 2).map((r) => r.parentItemId)).toEqual(['FG-800', 'FG-800', 'FG-800']);
  });

  it('returns a single parent chain for a part used in one place', () => {
    const state = importConveyor();
    expect(whereUsed('PT-850', state.bomLines, 'E', 0)).toEqual([
      { parentItemId: 'SA-820', depth: 1 },
      { parentItemId: 'FG-800', depth: 2 },
    ]);
  });

  // コンベア装置は工順が空なので、投入工程は未割当になる（作業区と工順は後続のPRで足す）
  it('converts to an M-BOM with the same structure and no input operation', () => {
    const state = importAndConvert();
    expect(state.lastError).toBeNull();
    const mbom = currentMbomLines(state.bomLines);
    expect(mbom).toHaveLength(10);
    expect(mbom.every((l) => l.processStep === undefined)).toBe(true);
  });

  it('sums the shared bolt across its three parents in the purchase BOM', () => {
    const state = importAndConvert();
    const purchase = buildPurchaseBom('FG-800', currentMbomLines(state.bomLines), state.items, 0);
    const byId = Object.fromEntries(purchase.map((p) => [p.itemId, p]));
    expect(Object.keys(byId).sort()).toEqual(['PT-850', 'PT-860', 'PT-870', 'PT-880', 'RM-840']);
    expect(byId['PT-880'].totalQtyPer).toBe(16);
    expect(byId['PT-880'].extendedCost).toBe(480);
    expect(purchase.every((p) => !p.supplierMissing)).toBe(true);
  });

  it('rolls up the purchased-part cost to 31,480 yen', () => {
    const state = importAndConvert();
    // 鋼材2000×2 + ボルト30×16 + モーター15000 + 歯車1500×2 + 電装部品3000×3
    expect(computeRolledUpCost('FG-800', currentMbomLines(state.bomLines), state.items)).toBe(31480);
  });

  it('explodes the planning BOM with the motor as the longest path (need day 100 → order by day 84)', () => {
    const state = importAndConvert();
    const lines = explodePlanningBom('FG-800', 1, 100, 0, state.bomLines, state.items);
    const motor = lines.find((l) => l.itemId === 'PT-850');
    // コンベア装置LT2 → 駆動部LT4 → モーターLT10
    expect(motor?.needByDay).toBe(94);
    expect(motor?.startByDay).toBe(84);
    expect(Math.min(...lines.map((l) => l.startByDay))).toBe(84);
  });
});

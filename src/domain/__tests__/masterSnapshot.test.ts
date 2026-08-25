import { describe, expect, it } from 'vitest';
import {
  buildUpdatedMasterSnapshot,
  checkReferentialIntegrityBeforeExport,
  detectBomCycles,
  hashSnapshot,
  importMasterSnapshot,
  parseMasterSnapshot,
  preflightExport,
  recordTouchedByChange,
} from '../masterSnapshot';
import type { EngineeringChange, MasterSnapshot, PlmBomLine, PlmItem, Passthrough } from '../types';

function baseSnapshot(): MasterSnapshot {
  return {
    version: 1,
    items: [
      { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, salesPrice: 6000 },
      { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 250, defaultSupplierId: 'SUP-2' },
    ],
    bom: [{ parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4 }],
    routingSteps: [{ itemId: 'FG-100', stepNo: 1, workCenter: 'WC-ASM', stdTimeMin: 30 }],
    workCenters: [{ workCenter: 'WC-ASM', ratePerHour: 2400, capacityMinPerDay: 480 }],
    customers: [],
    suppliers: [{ supplierId: 'SUP-2', name: '金物屋' }],
  };
}

describe('parseMasterSnapshot / assertSnapshotUsable', () => {
  it('parses a well-formed snapshot (bom, not bomLines)', () => {
    const parsed = parseMasterSnapshot(baseSnapshot());
    expect(parsed.bom).toHaveLength(1);
  });

  it('rejects an invalid makeBuy literal at the schema layer', () => {
    const bad = { ...baseSnapshot(), items: [{ itemId: 'X', name: 'x', makeBuy: 'RENT', leadTimeDays: 1 }] };
    expect(() => parseMasterSnapshot(bad)).toThrow();
  });

  it('detects a circular BOM across the whole snapshot (second line of defense)', () => {
    const bom = [
      { parentItemId: 'A', childItemId: 'B', qtyPer: 1 },
      { parentItemId: 'B', childItemId: 'C', qtyPer: 1 },
      { parentItemId: 'C', childItemId: 'A', qtyPer: 1 },
    ];
    expect(detectBomCycles(bom)).not.toHaveLength(0);
  });
});

describe('importMasterSnapshot (7.3, UC-SYNC-1)', () => {
  it('imports items as lifecycleStatus 量産, BOM as E-BOM v1, and keeps passthrough intact', () => {
    const result = importMasterSnapshot(baseSnapshot(), 0);
    expect(result.items.every((i) => i.lifecycleStatus === '量産')).toBe(true);
    expect(result.bomLines.every((l) => l.bomType === 'E' && l.version === 1)).toBe(true);
    expect(result.passthrough.workCenters).toHaveLength(1);
    expect(result.session.baseline).toEqual(baseSnapshot());
    expect(result.session.touchedItemIds.size).toBe(0);
  });
});

describe('checkReferentialIntegrityBeforeExport / buildUpdatedMasterSnapshot (UC-SYNC-3, UC-SYNC-6)', () => {
  const passthrough: Passthrough = {
    routingSteps: [{ itemId: 'FG-100', stepNo: 1, workCenter: 'WC-ASM', stdTimeMin: 30 }],
    workCenters: [{ workCenter: 'WC-ASM', ratePerHour: 2400, capacityMinPerDay: 480 }],
    customers: [],
    suppliers: [],
  };
  const items: PlmItem[] = [{ itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産' }];
  const mbomLines: PlmBomLine[] = [];

  // UC-SYNC-6
  it('flags a BUY item missing defaultSupplierId before export', () => {
    const withUnsuppliedBuy: PlmItem[] = [
      ...items,
      { itemId: 'RM-301', name: 'クッション材', makeBuy: 'BUY', leadTimeDays: 4, lifecycleStatus: '設計確定' },
    ];
    const problems = checkReferentialIntegrityBeforeExport(withUnsuppliedBuy, mbomLines, passthrough);
    expect(problems.some((p) => p.includes('RM-301'))).toBe(true);
  });

  // UC-SYNC-3
  it('rejects building an export snapshot for a non-closed ECO', () => {
    const change: EngineeringChange = {
      changeId: 'ECO-1',
      type: 'ECO',
      status: 'ECO発行',
      reason: 'コスト削減',
      changeLevel: '軽微',
      effectiveFromDay: 10,
      impactedItemIds: [],
      impactedBomLineIds: [],
      approvals: [],
    };
    expect(() => buildUpdatedMasterSnapshot(change, items, mbomLines, passthrough)).toThrow();
  });

  it('builds an export snapshot for a closed ECO with effectiveFromDay set', () => {
    const change: EngineeringChange = {
      changeId: 'ECO-1',
      type: 'ECN',
      status: 'クローズ',
      reason: 'コスト削減',
      changeLevel: '軽微',
      effectiveFromDay: 10,
      impactedItemIds: [],
      impactedBomLineIds: [],
      approvals: [],
    };
    const snapshot = buildUpdatedMasterSnapshot(change, items, mbomLines, passthrough);
    expect(snapshot.items).toEqual([{ itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2 }]);
  });
});

describe('preflightExport 3-way merge (7.4, 9.6, UC-SYNC-7/8)', () => {
  // UC-SYNC-7
  it('auto-adopts the counterpart change when PLM has not touched that item', () => {
    const baseline = baseSnapshot();
    const session = {
      importedAtDay: 0,
      baseline,
      touchedItemIds: new Set<string>(),
      touchedBomKeys: new Set<string>(),
    };
    const current = structuredClone(baseline);
    current.items[1].purchasePrice = 260; // production_system_sim側で直接編集

    const result = preflightExport(session, current, importMasterSnapshot(baseline, 0).items, []);
    expect(result.status).toBe('autoMerged');
    expect(result.mergedSnapshot?.items.find((i) => i.itemId === 'PT-400')?.purchasePrice).toBe(260);
  });

  // UC-SYNC-8
  it('flags a conflict when both PLM and production_system_sim touched the same item', () => {
    const baseline = baseSnapshot();
    const session = {
      importedAtDay: 0,
      baseline,
      touchedItemIds: new Set<string>(['PT-400']),
      touchedBomKeys: new Set<string>(),
    };
    const current = structuredClone(baseline);
    current.items[1].purchasePrice = 260; // 相手側も同じ品目を変更

    const ourItems = importMasterSnapshot(baseline, 0).items;
    ourItems.find((i) => i.itemId === 'PT-400')!.purchasePrice = 240; // PLM側でも変更済み

    const result = preflightExport(session, current, ourItems, []);
    expect(result.status).toBe('conflict');
    expect(result.conflicts?.[0]).toMatchObject({ kind: 'item', key: 'PT-400' });
  });

  it('produces a clean result when nothing changed on either side', () => {
    const baseline = baseSnapshot();
    const session = {
      importedAtDay: 0,
      baseline,
      touchedItemIds: new Set<string>(),
      touchedBomKeys: new Set<string>(),
    };
    const result = preflightExport(session, structuredClone(baseline), importMasterSnapshot(baseline, 0).items, []);
    expect(result.status).toBe('clean');
  });
});

describe('recordTouchedByChange', () => {
  it('accumulates touched item ids and BOM keys from a closed change', () => {
    const session = {
      importedAtDay: 0,
      baseline: baseSnapshot(),
      touchedItemIds: new Set<string>(),
      touchedBomKeys: new Set<string>(),
    };
    const change: EngineeringChange = {
      changeId: 'ECO-1',
      type: 'ECO',
      status: 'クローズ',
      reason: 'コスト削減',
      changeLevel: '軽微',
      impactedItemIds: ['PT-400'],
      impactedBomLineIds: ['M-1'],
      approvals: [],
    };
    const mbomLines: PlmBomLine[] = [
      { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
    ];
    recordTouchedByChange(session, change, mbomLines);
    expect(session.touchedItemIds.has('PT-400')).toBe(true);
    expect(session.touchedBomKeys.has('FG-100::PT-400')).toBe(true);
  });
});

describe('hashSnapshot', () => {
  it('is stable regardless of array ordering', async () => {
    const a = baseSnapshot();
    const b = { ...baseSnapshot(), items: [...baseSnapshot().items].reverse() };
    expect(await hashSnapshot(a)).toBe(await hashSnapshot(b));
  });

  it('changes when the content changes', async () => {
    const a = baseSnapshot();
    const b = structuredClone(a);
    b.items[0].name = '別の名前';
    expect(await hashSnapshot(a)).not.toBe(await hashSnapshot(b));
  });
});

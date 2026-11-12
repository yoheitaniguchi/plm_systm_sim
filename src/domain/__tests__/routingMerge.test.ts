// 工順の3-wayマージのテスト（design.md PLM-EXT-20）。
// 比較の単位は品目ごとの工順一式。「PLMが触った／相手が変えた」の4通りと、相手側を採用したときの工程の追従を確かめる。
import { describe, expect, it } from 'vitest';
import { checkInputOperations, currentMbomLines } from '../mbom';
import { adoptRoutingSteps, currentOperations, operationsFromRoutingSteps } from '../operation';
import { conveyorMasterSnapshot, createWoodenChairDemoState, woodenChairMasterSnapshot, woodenChairOperationNames } from '../presets';
import { createInitialState, reducer } from '../reducer';
import type { AppState } from '../reducer';
import type { MasterSnapshot } from '../types';

// 木製イスの工順：SA-200 [10 WC-CUT 18分]、FG-100 [10 WC-ASM 30分, 20 WC-INS 12分]
function importChair(): AppState {
  return reducer(createInitialState(), {
    type: 'sync/import',
    json: woodenChairMasterSnapshot,
    importedAtDay: 0,
    operationNames: woodenChairOperationNames,
  });
}

function theirSnapshot(edit: (s: MasterSnapshot) => void): MasterSnapshot {
  const s = structuredClone(woodenChairMasterSnapshot);
  edit(s);
  return s;
}

function addPacking(state: AppState): AppState {
  return reducer(state, {
    type: 'operation/add',
    input: { itemId: 'FG-100', name: '梱包', workCenter: 'WC-INS', stdTimeMin: 5, effectiveFromDay: 0 },
  });
}

function routingOf(snapshot: MasterSnapshot | undefined, itemId: string) {
  return (snapshot?.routingSteps ?? []).filter((s) => s.itemId === itemId).map((s) => [s.stepNo, s.workCenter, s.stdTimeMin]);
}

describe('routing 3-way merge (PLM-EXT-20)', () => {
  it('× ×: keeps the baseline routing when neither side changed it', () => {
    let state = importChair();
    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    expect(state.exportPreflight?.status).toBe('clean');
    expect(state.exportPreflight?.mergedSnapshot?.routingSteps).toHaveLength(3);
    expect(state.exportPreflight?.exportProblems).toEqual([]);
  });

  it('○ ×: exports the PLM routing for an item whose operations PLM edited', () => {
    let state = addPacking(importChair());
    expect(state.syncSession?.touchedRoutingItemIds.has('FG-100')).toBe(true);
    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    expect(state.exportPreflight?.status).toBe('clean');
    expect(routingOf(state.exportPreflight?.mergedSnapshot, 'FG-100')).toEqual([
      [10, 'WC-ASM', 30],
      [20, 'WC-INS', 12],
      [30, 'WC-INS', 5],
    ]);
    expect(routingOf(state.exportPreflight?.mergedSnapshot, 'SA-200')).toEqual([[10, 'WC-CUT', 18]]);
  });

  it('records the item as touched on revise, reorder and end as well', () => {
    for (const edit of [
      (s: AppState) => reducer(s, { type: 'operation/revise', operationId: currentOperations(s.operations, 'FG-100')[0].operationId, patch: { stdTimeMin: 35 }, effectiveFromDay: 1 }),
      (s: AppState) => reducer(s, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP20', 'OP10'], effectiveFromDay: 1 }),
      (s: AppState) => reducer(s, { type: 'operation/end', operationId: currentOperations(s.operations, 'FG-100')[1].operationId, effectiveToDay: 1 }),
    ]) {
      const state = edit(reducer(importChair(), { type: 'ui/advanceDay', byDays: 1 }));
      expect(state.lastError).toBeNull();
      expect([...state.syncSession!.touchedRoutingItemIds]).toEqual(['FG-100']);
    }
  });

  it('discards the preflight result when an operation is edited after it, so a stale result cannot be confirmed', () => {
    let state = importChair();
    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    expect(state.exportPreflight).not.toBeNull();
    state = addPacking(state);
    expect(state.exportPreflight).toBeNull();
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toMatch(/先にエクスポート前確認/);
    expect(state.syncSession?.touchedRoutingItemIds.has('FG-100')).toBe(true);
  });

  it('discards the preflight result on import, so a result about another master cannot be confirmed', () => {
    let state = importChair();
    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    state = reducer(state, { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
    expect(state.exportPreflight).toBeNull();
    const before = state.operations;
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toMatch(/先にエクスポート前確認/);
    expect(state.operations).toEqual(before);
  });

  it('does not record the item when a reorder keeps the current order', () => {
    let state = reducer(importChair(), { type: 'ui/advanceDay', byDays: 1 });
    state = reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP10', 'OP20'], effectiveFromDay: 1 });
    expect(state.lastError).toBeNull();
    expect(state.syncSession?.touchedRoutingItemIds.size).toBe(0);
  });

  it('○ ○: reports a conflict even when both sides ended up with the same routing', () => {
    let state = addPacking(importChair());
    const current = theirSnapshot((s) => {
      s.routingSteps.push({ itemId: 'FG-100', stepNo: 30, workCenter: 'WC-INS', stdTimeMin: 5 });
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.status).toBe('conflict');
    expect(state.exportPreflight?.conflicts?.[0]).toMatchObject({ kind: 'routing', key: 'FG-100' });
  });

  it('○ ○ after a PLM reorder: compares the whole routing of the item, not step by step', () => {
    let state = reducer(importChair(), { type: 'ui/advanceDay', byDays: 1 });
    state = reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP20', 'OP10'], effectiveFromDay: 1 });
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 10)!.stdTimeMin = 40;
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.conflicts).toHaveLength(1);
    expect(state.exportPreflight?.conflicts?.[0].ours).toEqual([
      { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-INS', stdTimeMin: 12 },
      { itemId: 'FG-100', stepNo: 20, workCenter: 'WC-ASM', stdTimeMin: 30 },
    ]);
  });

  it('keeps baseline, operations and the touched record consistent after resolving and confirming', () => {
    let state = addPacking(importChair());
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 20)!.stdTimeMin = 15;
      s.routingSteps.find((r) => r.itemId === 'SA-200')!.stdTimeMin = 20; // こちらはPLMが触っていない → 自動採用
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'routing', key: 'FG-100', resolution: 'ours' });
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toBeNull();
    expect(routingOf(state.syncSession?.baseline, 'FG-100')).toEqual([
      [10, 'WC-ASM', 30],
      [20, 'WC-INS', 12],
      [30, 'WC-INS', 5],
    ]);
    expect(routingOf(state.syncSession?.baseline, 'SA-200')).toEqual([[10, 'WC-CUT', 20]]);
    expect(currentOperations(state.operations, 'FG-100').map((o) => o.stdTimeMin)).toEqual([30, 12, 5]);
    expect(currentOperations(state.operations, 'SA-200').map((o) => [o.name, o.stdTimeMin, o.version])).toEqual([['切断', 20, 2]]);
    expect(state.syncSession?.touchedRoutingItemIds.size).toBe(0);
  });

  it('adds only the missing work centers when the other side is adopted in a conflict', () => {
    let state = addPacking(importChair());
    const current = theirSnapshot((s) => {
      s.workCenters = s.workCenters.filter((w) => w.workCenter !== 'WC-CUT');
      s.workCenters.push({ workCenter: 'WC-PACK', ratePerHour: 2400, capacityMinPerDay: 480 });
      s.routingSteps = s.routingSteps.filter((r) => r.itemId !== 'SA-200');
      s.routingSteps.push({ itemId: 'FG-100', stepNo: 30, workCenter: 'WC-PACK', stdTimeMin: 6 });
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'routing', key: 'FG-100', resolution: 'theirs' });
    expect(state.lastError).toBeNull();
    // 確定前：足りない作業区だけ足し、相手側が無くした作業区はまだ残す
    expect(state.passthrough.workCenters.map((w) => w.workCenter).sort()).toEqual(['WC-ASM', 'WC-CUT', 'WC-INS', 'WC-PACK']);
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toBeNull();
    expect(state.passthrough.workCenters.map((w) => w.workCenter).sort()).toEqual(['WC-ASM', 'WC-INS', 'WC-PACK']);
    // 相手側が工順を丸ごと無くした品目（SA-200）は、工程がすべて終了する
    expect(currentOperations(state.operations, 'SA-200')).toEqual([]);
  });

  it('does not record the item when the operation edit is rejected', () => {
    const state = reducer(importChair(), {
      type: 'operation/add',
      input: { itemId: 'FG-100', name: '梱包', workCenter: 'WC-NONE', stdTimeMin: 5, effectiveFromDay: 0 },
    });
    expect(state.lastError).not.toBeNull();
    expect(state.syncSession?.touchedRoutingItemIds.size).toBe(0);
  });

  it('× ○: auto-adopts the other side\'s routing, and the PLM operations follow it at export confirmation', () => {
    let state = importChair();
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 10)!.stdTimeMin = 40;
      s.workCenters.push({ workCenter: 'WC-PACK', ratePerHour: 2400, capacityMinPerDay: 480 });
      s.routingSteps.push({ itemId: 'FG-100', stepNo: 30, workCenter: 'WC-PACK', stdTimeMin: 5, setupMin: 2 });
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.status).toBe('autoMerged');
    expect(state.exportPreflight?.autoMergedNotes?.some((n) => n.includes('FG-100') && n.includes('工順'))).toBe(true);
    expect(routingOf(state.exportPreflight?.mergedSnapshot, 'FG-100')).toEqual([
      [10, 'WC-ASM', 40],
      [20, 'WC-INS', 12],
      [30, 'WC-PACK', 5],
    ]);
    // 確定するまで、PLM側の工程は変わらない
    expect(currentOperations(state.operations, 'FG-100').map((o) => o.stdTimeMin)).toEqual([30, 12]);

    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toBeNull();
    const ops = currentOperations(state.operations, 'FG-100');
    // 順序が一致する工程は、工程コードと名称を保ったまま版が上がる。相手側にだけある順序は新しい工程になる
    expect(ops.map((o) => [o.opCode, o.stepNo, o.name, o.workCenter, o.stdTimeMin, o.version])).toEqual([
      ['OP10', 10, '組立', 'WC-ASM', 40, 2],
      ['OP20', 20, '検査', 'WC-INS', 12, 1],
      ['OP30', 30, '工程30', 'WC-PACK', 5, 1],
    ]);
    expect(ops[2].setupMin).toBe(2);
    // 旧版は履歴に残る
    expect(state.operations.filter((o) => o.itemId === 'FG-100' && o.opCode === 'OP10')).toHaveLength(2);
    // 作業区の控えも相手側の最新になり、新しい作業区を工程で使える
    expect(state.passthrough.workCenters.map((w) => w.workCenter)).toContain('WC-PACK');
    expect(state.syncSession?.touchedRoutingItemIds.size).toBe(0);
    // 新しいベースラインで、もう一度確認しても差分は出ない
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.status).toBe('clean');
  });

  it('○ ○: reports a routing conflict keyed by the item, with both routings', () => {
    let state = addPacking(importChair());
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 20)!.stdTimeMin = 15;
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.status).toBe('conflict');
    expect(state.exportPreflight?.conflicts).toHaveLength(1);
    const conflict = state.exportPreflight!.conflicts![0];
    expect(conflict).toMatchObject({ kind: 'routing', key: 'FG-100' });
    expect((conflict.ours as unknown[]).length).toBe(3);
    expect((conflict.theirs as unknown[]).length).toBe(2);
    // 競合が残っている間は確定できない
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toMatch(/競合/);
  });

  it('resolves a routing conflict with the PLM side: the PLM routing is exported and operations stay', () => {
    let state = addPacking(importChair());
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 20)!.stdTimeMin = 15;
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    const before = state.operations;
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'routing', key: 'FG-100', resolution: 'ours' });
    expect(state.lastError).toBeNull();
    expect(state.exportPreflight?.status).not.toBe('conflict');
    expect(state.operations).toEqual(before);
    expect(routingOf(state.exportPreflight?.mergedSnapshot, 'FG-100')).toEqual([
      [10, 'WC-ASM', 30],
      [20, 'WC-INS', 12],
      [30, 'WC-INS', 5],
    ]);
  });

  it('resolves a routing conflict with the other side: operations follow, and resources of ended operations are removed', () => {
    let state = createWoodenChairDemoState();
    state = addPacking(state); // FG-100にOP30（梱包）を足す。相手側には無い
    state = reducer(state, {
      type: 'resource/add',
      input: { itemId: 'FG-100', opCode: 'OP30', kind: '設備', code: 'EQ-PACK', name: '梱包機', requiredQty: 1 },
    });
    state = reducer(state, {
      type: 'resource/add',
      input: { itemId: 'FG-100', opCode: 'OP20', kind: '治具・工具', code: 'JIG-INS', name: '検査治具', requiredQty: 1 },
    });
    expect(state.lastError).toBeNull();
    const current = theirSnapshot((s) => {
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 20)!.stdTimeMin = 15;
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    expect(state.exportPreflight?.status).toBe('conflict');
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'routing', key: 'FG-100', resolution: 'theirs' });
    expect(state.lastError).toBeNull();
    expect(state.exportPreflight?.status).not.toBe('conflict');
    expect(routingOf(state.exportPreflight?.mergedSnapshot, 'FG-100')).toEqual([
      [10, 'WC-ASM', 30],
      [20, 'WC-INS', 15],
    ]);
    expect(currentOperations(state.operations, 'FG-100').map((o) => [o.opCode, o.name, o.stdTimeMin, o.version])).toEqual([
      ['OP10', '組立', 30, 1],
      ['OP20', '検査', 15, 2],
    ]);
    // 終了した工程（OP30）の資源は消え、残った工程（OP20）の資源は残る
    expect(state.operationResources.map((r) => r.name)).toEqual(['検査治具']);
    // 終了した工程も履歴には残る
    expect(state.operations.some((o) => o.itemId === 'FG-100' && o.opCode === 'OP30' && o.effectiveToDay !== undefined)).toBe(true);
  });

  it('flags M-BOM lines whose input operation was ended by adopting the other side\'s routing', () => {
    let state = importChair();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    const line = currentMbomLines(state.bomLines).find((l) => l.parentItemId === 'FG-100')!;
    state = reducer(state, { type: 'mbom/assignOperation', bomLineId: line.bomLineId, opCode: 'OP20' });
    expect(state.lastError).toBeNull();
    // 相手側がFG-100の検査（順序20）を無くした。PLMは工順を触っていないので自動採用になる
    const current = theirSnapshot((s) => {
      s.routingSteps = s.routingSteps.filter((r) => !(r.itemId === 'FG-100' && r.stepNo === 20));
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toBeNull();
    expect(currentOperations(state.operations, 'FG-100').map((o) => o.opCode)).toEqual(['OP10']);
    const problems = checkInputOperations(currentMbomLines(state.bomLines), state.operations);
    expect(problems).toEqual([expect.objectContaining({ bomLineId: line.bomLineId, kind: '無効', processStep: 'OP20' })]);
  });

  it('refuses to confirm the export while the merged routing points at a missing work center', () => {
    let state = addPacking(importChair()); // PLM側のFG-100はWC-INSを使う
    // 相手側はWC-INSを無くし、FG-100の検査をWC-ASMへ移した
    const current = theirSnapshot((s) => {
      s.workCenters = s.workCenters.filter((w) => w.workCenter !== 'WC-INS');
      s.routingSteps.find((r) => r.itemId === 'FG-100' && r.stepNo === 20)!.workCenter = 'WC-ASM';
    });
    state = reducer(state, { type: 'sync/preflight', currentJson: current });
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'routing', key: 'FG-100', resolution: 'ours' });
    expect(state.exportPreflight?.status).not.toBe('conflict');
    expect(state.exportPreflight?.exportProblems?.some((p) => p.includes('WC-INS'))).toBe(true);
    const before = state.syncEvents.length;
    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: '' });
    expect(state.lastError).toMatch(/WC-INS/);
    expect(state.syncEvents).toHaveLength(before);
    expect(state.exportPreflight).not.toBeNull();
  });
});

describe('adoptRoutingSteps', () => {
  it('gives a new step an unused operation code when the code of its step number was used before', () => {
    const ops = operationsFromRoutingSteps([
      { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 },
      { itemId: 'FG-100', stepNo: 20, workCenter: 'WC-INS', stdTimeMin: 12 },
    ]);
    let n = 0;
    const newId = () => `OPN-T${++n}`;
    // 順序20を無くす → OP20は終了
    const ended = adoptRoutingSteps(ops, 'FG-100', [{ itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 }], newId, 3);
    expect(ended.map((o) => [o.opCode, o.effectiveToDay])).toEqual([['OP20', 3]]);
    // 順序20が別の内容で戻ってきた → 終了済みのOP20は使い回さず、OP30になる
    adoptRoutingSteps(
      ops,
      'FG-100',
      [
        { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 },
        { itemId: 'FG-100', stepNo: 20, workCenter: 'WC-ASM', stdTimeMin: 8 },
      ],
      newId,
      5,
    );
    expect(currentOperations(ops, 'FG-100').map((o) => [o.opCode, o.stepNo, o.effectiveFromDay])).toEqual([
      ['OP10', 10, 0],
      ['OP30', 20, 5],
    ]);
  });

  it('closes a future-dated operation at its own start day, and updates or drops setupMin', () => {
    const ops = operationsFromRoutingSteps([{ itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30, setupMin: 5 }]);
    ops[0].effectiveFromDay = 7;
    adoptRoutingSteps(ops, 'FG-100', [{ itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 }], () => 'OPN-T1', 2);
    expect(ops.map((o) => [o.version, o.effectiveFromDay, o.effectiveToDay, o.setupMin])).toEqual([
      [1, 7, 7, 5],
      [2, 7, undefined, undefined],
    ]);
    expect('setupMin' in ops[1]).toBe(false);
  });

  it('changes nothing when the routing already matches', () => {
    const ops = operationsFromRoutingSteps(woodenChairMasterSnapshot.routingSteps);
    const before = structuredClone(ops);
    expect(adoptRoutingSteps(ops, 'FG-100', woodenChairMasterSnapshot.routingSteps, () => 'X', 4)).toEqual([]);
    expect(ops).toEqual(before);
  });
});

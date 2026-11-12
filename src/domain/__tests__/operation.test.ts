// 工程（BOP）ドメインのテスト（design.md PLM-EXT-17）。
import { describe, expect, it } from 'vitest';
import {
  addOperation,
  checkOperations,
  currentOperations,
  endOperation,
  operationsFromRoutingSteps,
  reorderOperations,
  reviseOperation,
  routingStepsFromOperations,
} from '../operation';
import { createWoodenChairDemoState, woodenChairMasterSnapshot } from '../presets';
import { createInitialState, reducer } from '../reducer';
import type { Operation, PlmItem, WorkCenter } from '../types';

const items: PlmItem[] = [
  { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, lifecycleStatus: '量産' },
  { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, lifecycleStatus: '量産' },
];
const workCenters: WorkCenter[] = [
  { workCenter: 'WC-ASM', ratePerHour: 2400, capacityMinPerDay: 480 },
  { workCenter: 'WC-INS', ratePerHour: 2400, capacityMinPerDay: 480 },
];

function chairOperations(): Operation[] {
  return operationsFromRoutingSteps([
    { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 },
    { itemId: 'FG-100', stepNo: 20, workCenter: 'WC-INS', stdTimeMin: 12 },
  ]);
}

function idGenerator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe('operationsFromRoutingSteps / routingStepsFromOperations', () => {
  it('turns each routing step into a version-1 operation with opCode OP+stepNo', () => {
    const operations = chairOperations();
    expect(operations.map((o) => [o.opCode, o.stepNo, o.name, o.version, o.effectiveFromDay])).toEqual([
      ['OP10', 10, '工程10', 1, 0],
      ['OP20', 20, '工程20', 1, 0],
    ]);
  });

  it('round-trips routing steps unchanged, including setupMin', () => {
    const steps = [
      { itemId: 'SA-200', stepNo: 10, workCenter: 'WC-CUT', stdTimeMin: 18, setupMin: 5 },
      { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30 },
      { itemId: 'FG-100', stepNo: 20, workCenter: 'WC-INS', stdTimeMin: 12 },
    ];
    expect(routingStepsFromOperations(operationsFromRoutingSteps(steps))).toEqual(steps);
  });

  it('exports only current operations, without PLM-only fields', () => {
    const operations = chairOperations();
    reviseOperation(operations, workCenters, operations[0].operationId, { name: '組立', stdTimeMin: 35 }, 'N-1', 3);
    endOperation(operations, operations[1].operationId, 3);
    expect(routingStepsFromOperations(operations)).toEqual([
      { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 35 },
    ]);
  });
});

describe('addOperation', () => {
  it('appends after the last step and derives the operation code', () => {
    const operations = chairOperations();
    const added = addOperation(operations, items, workCenters, {
      operationId: 'N-1',
      itemId: 'FG-100',
      name: ' 梱包 ',
      workCenter: 'WC-INS',
      stdTimeMin: 5,
      effectiveFromDay: 2,
    });
    expect(added).toMatchObject({ opCode: 'OP30', stepNo: 30, name: '梱包', version: 1, effectiveFromDay: 2 });
  });

  it('starts at step 10 for an item without operations', () => {
    const added = addOperation([], items, workCenters, {
      operationId: 'N-1',
      itemId: 'FG-100',
      name: '組立',
      workCenter: 'WC-ASM',
      stdTimeMin: 30,
      effectiveFromDay: 0,
    });
    expect(added).toMatchObject({ opCode: 'OP10', stepNo: 10 });
  });

  it('never reuses the code of an ended operation', () => {
    const operations = chairOperations();
    endOperation(operations, operations[1].operationId, 1);
    const added = addOperation(operations, items, workCenters, {
      operationId: 'N-1',
      itemId: 'FG-100',
      name: '梱包',
      workCenter: 'WC-INS',
      stdTimeMin: 5,
      effectiveFromDay: 1,
    });
    // 順序は空いた20を使うが、工程コードOP20は終了した工程のものなので使わない
    expect(added).toMatchObject({ stepNo: 20, opCode: 'OP30' });
    expect(() =>
      addOperation(operations, items, workCenters, {
        operationId: 'N-2',
        itemId: 'FG-100',
        opCode: 'OP20',
        name: '再検査',
        workCenter: 'WC-INS',
        stdTimeMin: 5,
        effectiveFromDay: 1,
      }),
    ).toThrow('既に使われています');
  });

  it('rejects a work center that was not imported, a BUY item, and an unknown item', () => {
    const base = { operationId: 'N-1', name: '溶接', stdTimeMin: 10, effectiveFromDay: 0 };
    expect(() => addOperation([], items, workCenters, { ...base, itemId: 'FG-100', workCenter: 'WC-WELD' })).toThrow(
      '取り込み済みの作業区にありません',
    );
    expect(() => addOperation([], items, [], { ...base, itemId: 'FG-100', workCenter: 'WC-ASM' })).toThrow(
      'MasterSnapshotを取り込んでください',
    );
    expect(() => addOperation([], items, workCenters, { ...base, itemId: 'PT-400', workCenter: 'WC-ASM' })).toThrow('購買品目');
    expect(() => addOperation([], items, workCenters, { ...base, itemId: 'SA-999', workCenter: 'WC-ASM' })).toThrow('見つかりません');
  });
});

describe('reviseOperation', () => {
  it('closes the old version and adds a new one, keeping code, order and setup time', () => {
    const operations = operationsFromRoutingSteps([
      { itemId: 'FG-100', stepNo: 10, workCenter: 'WC-ASM', stdTimeMin: 30, setupMin: 8 },
    ]);
    const revised = reviseOperation(operations, workCenters, operations[0].operationId, { stdTimeMin: 25 }, 'N-1', 4, 'ECO-1');
    expect(operations[0].effectiveToDay).toBe(4);
    expect(revised).toMatchObject({
      operationId: 'N-1',
      opCode: 'OP10',
      stepNo: 10,
      stdTimeMin: 25,
      setupMin: 8,
      version: 2,
      effectiveFromDay: 4,
      changeId: 'ECO-1',
    });
    expect(revised.effectiveToDay).toBeUndefined();
    expect(currentOperations(operations, 'FG-100')).toEqual([revised]);
  });

  it('rejects a revision on the same day, of an old version, or to an unknown work center', () => {
    const operations = chairOperations();
    const id = operations[0].operationId;
    expect(() => reviseOperation(operations, workCenters, id, { stdTimeMin: 25 }, 'N-1', 0)).toThrow('旧版より後');
    expect(() => reviseOperation(operations, workCenters, id, { workCenter: 'WC-WELD' }, 'N-1', 1)).toThrow('取り込み済み');
    expect(operations).toHaveLength(2); // 拒否したときは何も変えない
    reviseOperation(operations, workCenters, id, { stdTimeMin: 25 }, 'N-1', 1);
    expect(() => reviseOperation(operations, workCenters, id, { stdTimeMin: 20 }, 'N-2', 2)).toThrow('旧版化または終了');
  });

  it('treats undefined patch values as unchanged, and rejects days that are not non-negative integers', () => {
    const operations = chairOperations();
    const id = operations[0].operationId;
    for (const day of [Number.NaN, -1, 1.5]) {
      expect(() => reviseOperation(operations, workCenters, id, { stdTimeMin: 25 }, 'N-1', day)).toThrow('0以上の整数');
      expect(() => endOperation(operations, id, day)).toThrow('0以上の整数');
      expect(() => reorderOperations(operations, 'FG-100', ['OP20', 'OP10'], idGenerator('N'), day)).toThrow('0以上の整数');
      expect(() =>
        addOperation(operations, items, workCenters, {
          operationId: 'N-9',
          itemId: 'FG-100',
          name: '梱包',
          workCenter: 'WC-INS',
          stdTimeMin: 5,
          effectiveFromDay: day,
        }),
      ).toThrow('0以上の整数');
    }
    expect(operations).toEqual(chairOperations());
    const revised = reviseOperation(operations, workCenters, id, { stdTimeMin: undefined, workCenter: undefined, name: '組立' }, 'N-1', 1);
    expect(revised).toMatchObject({ name: '組立', workCenter: 'WC-ASM', stdTimeMin: 30 });
  });

  it('does not carry the old changeId over to a revision made without one', () => {
    const operations = chairOperations();
    const v2 = reviseOperation(operations, workCenters, operations[0].operationId, { stdTimeMin: 25 }, 'N-1', 1, 'ECO-1');
    const v3 = reviseOperation(operations, workCenters, v2.operationId, { stdTimeMin: 20 }, 'N-2', 2);
    expect(v3.changeId).toBeUndefined();
  });
});

describe('reorderOperations', () => {
  it('swaps step numbers by raising the version of each moved operation', () => {
    const operations = chairOperations();
    const moved = reorderOperations(operations, 'FG-100', ['OP20', 'OP10'], idGenerator('N'), 5);
    expect(moved).toHaveLength(2);
    expect(currentOperations(operations, 'FG-100').map((o) => [o.opCode, o.stepNo, o.version, o.effectiveFromDay])).toEqual([
      ['OP20', 10, 2, 5],
      ['OP10', 20, 2, 5],
    ]);
    // 旧版は履歴に残る
    expect(operations.filter((o) => o.effectiveToDay === 5)).toHaveLength(2);
    expect(checkOperations(operations, items, workCenters)).toEqual([]);
  });

  it('leaves operations whose position does not change untouched', () => {
    const operations = chairOperations();
    addOperation(operations, items, workCenters, {
      operationId: 'N-0',
      itemId: 'FG-100',
      name: '梱包',
      workCenter: 'WC-INS',
      stdTimeMin: 5,
      effectiveFromDay: 0,
    });
    const moved = reorderOperations(operations, 'FG-100', ['OP10', 'OP30', 'OP20'], idGenerator('N'), 2);
    expect(moved.map((o) => o.opCode)).toEqual(['OP30', 'OP20']);
    const first = operations.find((o) => o.opCode === 'OP10');
    expect(first?.version).toBe(1);
    expect(first?.effectiveToDay).toBeUndefined();
    expect(reorderOperations(operations, 'FG-100', ['OP10', 'OP30', 'OP20'], idGenerator('M'), 3)).toEqual([]);
  });

  it('rejects the whole reorder, changing nothing, when one moved operation cannot be revised that day', () => {
    const operations = chairOperations();
    const before = structuredClone(operations);
    expect(() => reorderOperations(operations, 'FG-100', ['OP20', 'OP10'], idGenerator('N'), 0)).toThrow('旧版より後');
    expect(() => reorderOperations(operations, 'FG-100', ['OP20'], idGenerator('N'), 3)).toThrow('一致しません');
    // 片方だけ版を上げられない場合も、全体を拒否する（OP10を3日目に改訂 → 2日目付の入れ替え）
    const partial = chairOperations();
    reviseOperation(partial, workCenters, partial[0].operationId, { stdTimeMin: 25 }, 'N-0', 3);
    const partialBefore = structuredClone(partial);
    expect(() => reorderOperations(partial, 'FG-100', ['OP20', 'OP10'], idGenerator('N'), 2)).toThrow('旧版より後');
    expect(partial).toEqual(partialBefore);
    expect(() => reorderOperations(operations, 'FG-100', ['OP20', 'OP20'], idGenerator('N'), 3)).toThrow('一致しません');
    expect(operations).toEqual(before);
  });
});

describe('endOperation', () => {
  it('sets the end day instead of deleting, and rejects an end day before the start', () => {
    const operations = chairOperations();
    reviseOperation(operations, workCenters, operations[1].operationId, { stdTimeMin: 10 }, 'N-1', 3);
    expect(() => endOperation(operations, 'N-1', 2)).toThrow('有効開始日');
    endOperation(operations, 'N-1', 3);
    expect(operations).toHaveLength(3);
    expect(currentOperations(operations, 'FG-100').map((o) => o.opCode)).toEqual(['OP10']);
    expect(() => endOperation(operations, 'N-1', 4)).toThrow('旧版化または終了');
  });
});

describe('reducer: operations (PLM-EXT-17)', () => {
  it('seeds the default demo state with named operations that match the baseline routing', () => {
    const state = createWoodenChairDemoState();
    expect(state.operations.map((o) => [o.itemId, o.opCode, o.name, o.workCenter, o.stdTimeMin])).toEqual([
      ['SA-200', 'OP10', '切断', 'WC-CUT', 18],
      ['FG-100', 'OP10', '組立', 'WC-ASM', 30],
      ['FG-100', 'OP20', '検査', 'WC-INS', 12],
    ]);
    expect(routingStepsFromOperations(state.operations)).toEqual(woodenChairMasterSnapshot.routingSteps);
    expect(state.passthrough).not.toHaveProperty('routingSteps');
  });

  it('imports routing steps as operations and replaces the ones from the previous import', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'sync/import', json: woodenChairMasterSnapshot, importedAtDay: 0 });
    expect(state.lastError).toBeNull();
    expect(state.operations.map((o) => `${o.itemId}:${o.opCode}:${o.name}`)).toEqual([
      'SA-200:OP10:工程10',
      'FG-100:OP10:工程10',
      'FG-100:OP20:工程20',
    ]);
  });

  it('adds, revises, reorders and ends operations through actions, with ids that do not collide', () => {
    let state = reducer(createInitialState(), { type: 'sync/import', json: woodenChairMasterSnapshot, importedAtDay: 0 });
    state = reducer(state, {
      type: 'operation/add',
      input: { itemId: 'FG-100', name: '梱包', workCenter: 'WC-INS', stdTimeMin: 5, effectiveFromDay: 0 },
    });
    expect(state.lastError).toBeNull();
    const packing = currentOperations(state.operations, 'FG-100')[2];
    expect(packing).toMatchObject({ opCode: 'OP30', stepNo: 30 });

    state = reducer(state, { type: 'operation/revise', operationId: packing.operationId, patch: { stdTimeMin: 8 }, effectiveFromDay: 2 });
    state = reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP10', 'OP30', 'OP20'], effectiveFromDay: 3 });
    expect(state.lastError).toBeNull();
    expect(currentOperations(state.operations, 'FG-100').map((o) => [o.opCode, o.stepNo, o.stdTimeMin])).toEqual([
      ['OP10', 10, 30],
      ['OP30', 20, 8],
      ['OP20', 30, 12],
    ]);

    const inspection = currentOperations(state.operations, 'FG-100')[2];
    state = reducer(state, { type: 'operation/end', operationId: inspection.operationId, effectiveToDay: 4 });
    expect(currentOperations(state.operations, 'FG-100').map((o) => o.opCode)).toEqual(['OP10', 'OP30']);
    expect(new Set(state.operations.map((o) => o.operationId)).size).toBe(state.operations.length);
  });

  it('replaces operations on re-import and keeps new ids unique', () => {
    let state = createWoodenChairDemoState();
    const add = { type: 'operation/add', input: { itemId: 'FG-100', name: '梱包', workCenter: 'WC-INS', stdTimeMin: 5, effectiveFromDay: 0 } } as const;
    state = reducer(state, add);
    state = reducer(state, { type: 'sync/import', json: woodenChairMasterSnapshot, importedAtDay: 0 });
    expect(state.operations).toHaveLength(3);
    state = reducer(state, add);
    expect(new Set(state.operations.map((o) => o.operationId)).size).toBe(4);
  });

  it('reports a rejected operation edit as lastError without changing the operations', () => {
    const state = createWoodenChairDemoState();
    const next = reducer(state, {
      type: 'operation/add',
      input: { itemId: 'FG-100', name: '溶接', workCenter: 'WC-WELD', stdTimeMin: 5, effectiveFromDay: 0 },
    });
    expect(next.lastError).toContain('WC-WELD');
    expect(next.operations).toEqual(state.operations);
    const id = state.operations[0].operationId;
    const rejected = [
      reducer(state, { type: 'operation/revise', operationId: id, patch: { stdTimeMin: 1 }, effectiveFromDay: 0 }),
      reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP20', 'OP10'], effectiveFromDay: 0 }),
      reducer(state, { type: 'operation/end', operationId: 'NO-SUCH', effectiveToDay: 1 }),
    ];
    for (const r of rejected) {
      expect(r.lastError).not.toBeNull();
      expect(r.operations).toEqual(state.operations);
    }
  });
});

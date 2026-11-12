// 資源（BOR）ドメインのテスト（design.md PLM-EXT-19）。
import { describe, expect, it } from 'vitest';
import { currentOperations } from '../operation';
import { createWoodenChairDemoState, woodenChairMasterSnapshot } from '../presets';
import { reducer } from '../reducer';
import type { AppState } from '../reducer';
import { summarizeResourceUsage } from '../resource';

const jig = { itemId: 'FG-100', opCode: 'OP10', kind: '治具・工具', code: 'JIG-01', name: '組立治具', requiredQty: 1 } as const;

function add(state: AppState, input: Parameters<typeof reducer>[1] extends infer A ? (A extends { type: 'resource/add'; input: infer I } ? I : never) : never): AppState {
  return reducer(state, { type: 'resource/add', input });
}

describe('resources / BOR (PLM-EXT-19)', () => {
  it('adds equipment, tools and skills to a current operation, with either a quantity or a time', () => {
    let state = createWoodenChairDemoState();
    state = add(state, jig);
    state = add(state, { itemId: 'FG-100', opCode: 'OP10', kind: '作業者スキル', code: 'SK-ASM', name: ' 組立技能 ', requiredTimeMin: 30 });
    state = add(state, { itemId: 'SA-200', opCode: 'OP10', kind: '設備', code: 'EQ-SAW', name: '丸のこ盤', requiredQty: 1 });
    expect(state.lastError).toBeNull();
    expect(state.operationResources).toEqual([
      { resourceId: expect.any(String), ...jig },
      { resourceId: expect.any(String), itemId: 'FG-100', opCode: 'OP10', kind: '作業者スキル', code: 'SK-ASM', name: '組立技能', requiredTimeMin: 30 },
      { resourceId: expect.any(String), itemId: 'SA-200', opCode: 'OP10', kind: '設備', code: 'EQ-SAW', name: '丸のこ盤', requiredQty: 1 },
    ]);
    expect(new Set(state.operationResources.map((r) => r.resourceId)).size).toBe(3);
  });

  it('rejects invalid input without changing the resources', () => {
    const state = add(createWoodenChairDemoState(), jig);
    const cases: [Parameters<typeof add>[1], string][] = [
      [{ ...jig, opCode: 'OP99', code: 'X' }, '現在有効な工程にありません'],
      [{ ...jig, itemId: 'PT-400', code: 'X' }, '現在有効な工程にありません'],
      [{ ...jig }, '既に登録されています'],
      [{ ...jig, code: ' ' }, 'コードを入力'],
      [{ ...jig, code: 'X', name: '' }, '名称を入力'],
      [{ ...jig, code: 'X', requiredQty: undefined }, 'どちらか一方'],
      [{ ...jig, code: 'X', requiredTimeMin: 5 }, 'どちらか一方'],
      [{ ...jig, code: 'X', requiredQty: 0 }, '0より大きい'],
      [{ ...jig, code: 'X', requiredQty: Number.NaN }, '0より大きい'],
    ];
    for (const [input, message] of cases) {
      const next = add(state, input);
      expect(next.lastError).toContain(message);
      expect(next.operationResources).toEqual(state.operationResources);
    }
  });

  it('removes a resource without keeping history', () => {
    let state = add(createWoodenChairDemoState(), jig);
    const id = state.operationResources[0].resourceId;
    state = reducer(state, { type: 'resource/remove', resourceId: id });
    expect(state.operationResources).toEqual([]);
    expect(reducer(state, { type: 'resource/remove', resourceId: id }).lastError).toContain('見つかりません');
  });

  it('keeps resources attached when the operation is revised or reordered', () => {
    let state = add(createWoodenChairDemoState(), jig);
    const assembly = currentOperations(state.operations, 'FG-100')[0];
    state = reducer(state, { type: 'operation/revise', operationId: assembly.operationId, patch: { stdTimeMin: 25 }, effectiveFromDay: 1 });
    state = reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP20', 'OP10'], effectiveFromDay: 2 });
    expect(state.lastError).toBeNull();
    const current = currentOperations(state.operations, 'FG-100').find((o) => o.opCode === 'OP10')!;
    expect(state.operationResources[0]).toMatchObject({ itemId: current.itemId, opCode: current.opCode });
  });

  it('refuses to end an operation that still has resources', () => {
    let state = add(createWoodenChairDemoState(), { ...jig, opCode: 'OP20' });
    const inspection = currentOperations(state.operations, 'FG-100')[1];
    const refused = reducer(state, { type: 'operation/end', operationId: inspection.operationId, effectiveToDay: 1 });
    expect(refused.lastError).toContain('資源が1件登録されているため終了できません');
    expect(refused.operations).toEqual(state.operations);

    state = reducer(state, { type: 'resource/remove', resourceId: state.operationResources[0].resourceId });
    state = reducer(state, { type: 'operation/end', operationId: inspection.operationId, effectiveToDay: 1 });
    expect(state.lastError).toBeNull();
  });

  it('summarizes which operations need each resource across all items', () => {
    let state = createWoodenChairDemoState();
    state = add(state, { itemId: 'FG-100', opCode: 'OP20', kind: '作業者スキル', code: 'SK-INS', name: '検査技能', requiredTimeMin: 12 });
    state = add(state, { itemId: 'FG-100', opCode: 'OP10', kind: '治具・工具', code: 'TL-DRV', name: '電動ドライバー', requiredQty: 2 });
    state = add(state, { itemId: 'SA-200', opCode: 'OP10', kind: '治具・工具', code: 'TL-DRV', name: '電動ドライバ', requiredQty: 1 });
    expect(summarizeResourceUsage(state.operationResources)).toEqual([
      {
        kind: '治具・工具',
        code: 'TL-DRV',
        names: ['電動ドライバー', '電動ドライバ'],
        usedBy: [
          { itemId: 'FG-100', opCode: 'OP10', requiredQty: 2 },
          { itemId: 'SA-200', opCode: 'OP10', requiredQty: 1 },
        ],
      },
      { kind: '作業者スキル', code: 'SK-INS', names: ['検査技能'], usedBy: [{ itemId: 'FG-100', opCode: 'OP20', requiredTimeMin: 12 }] },
    ]);
  });

  it('clears resources on import, and never writes them to the export snapshot', () => {
    let state = add(createWoodenChairDemoState(), jig);
    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    expect(JSON.stringify(state.exportPreflight?.mergedSnapshot)).not.toContain('JIG-01');
    state = reducer(state, { type: 'sync/import', json: woodenChairMasterSnapshot, importedAtDay: 0 });
    expect(state.operationResources).toEqual([]);
  });
});

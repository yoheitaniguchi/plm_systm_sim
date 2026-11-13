// localStorage 永続化：直列化・検証つき読み込み・保存先とのやりとり（design.md PLM-EXT-24）。
import { describe, expect, it } from 'vitest';
import {
  BROKEN_KEY,
  SETTINGS_KEY,
  STATE_KEY,
  loadSavedState,
  parseSavedState,
  readSettings,
  saveState,
  serializeState,
  setPersistenceEnabled,
  type KeyValueStorage,
} from '../persistence';
import { conveyorMasterSnapshot, createWoodenChairDemoState } from '../presets';
import { reducer, type AppState } from '../reducer';

const AT = '2026-11-13T10:00:00.000Z';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

// 連携のセッション（Set を含む）、工程・資源、変更、E-BOM行の置換を持つ状態
function richState(): AppState {
  let state = reducer(createWoodenChairDemoState(), { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
  state = reducer(state, {
    type: 'change/create',
    input: { changeId: 'ECR-1', reason: 'コスト削減', changeLevel: '軽微', impactedItemIds: ['SA-820'], impactedBomLineIds: [] },
  });
  state = reducer(state, { type: 'ui/advanceDay', byDays: 1 });
  const motor = state.bomLines.find((l) => l.parentItemId === 'SA-820' && l.childItemId === 'PT-850' && l.bomType === 'E')!;
  state = reducer(state, { type: 'ebom/replaceChild', bomLineId: motor.bomLineId, newChildItemId: 'PT-870', effectiveFromDay: 1, changeId: 'ECR-1' });
  const op = state.operations.find((o) => o.effectiveToDay === undefined)!;
  state = reducer(state, {
    type: 'resource/add',
    input: { itemId: op.itemId, opCode: op.opCode, kind: '設備', code: 'EQ-1', name: '設備1', requiredQty: 1 },
  });
  state.syncSession!.touchedItemIds.add('SA-820');
  state.syncSession!.touchedRoutingItemIds.add(op.itemId);
  expect(state.lastError).toBeNull();
  return state;
}

const savedJson = (state: AppState) => serializeState(state, AT);
const mutate = (state: AppState, edit: (raw: Record<string, unknown>) => void) => {
  const parsed = JSON.parse(savedJson(state));
  edit(parsed);
  return JSON.stringify(parsed);
};

describe('serializeState / parseSavedState', () => {
  it('round-trips the whole state, turning the sync session Sets into arrays and back', () => {
    const state = richState();
    const restored = parseSavedState(savedJson(state));
    expect(restored).toEqual({ ...state, lastError: null, lastWarning: null, exportPreflight: null, pendingCurrentSnapshot: null });
    expect(restored.syncSession!.touchedItemIds).toBeInstanceOf(Set);
    expect([...restored.syncSession!.touchedItemIds]).toEqual([...state.syncSession!.touchedItemIds]);
    expect([...restored.syncSession!.touchedRoutingItemIds]).toEqual([...state.syncSession!.touchedRoutingItemIds]);
  });

  it('round-trips a state with no sync session (before the first import)', () => {
    const state = { ...createWoodenChairDemoState(), syncSession: null };
    const restored = parseSavedState(savedJson(state));
    expect(restored).toEqual(state);
    expect(restored.syncSession).toBeNull();
  });

  it('does not save the transient values', () => {
    const state = { ...createWoodenChairDemoState(), lastError: 'エラー', lastWarning: '警告' };
    const saved = JSON.parse(savedJson(state));
    expect(saved).toMatchObject({ kind: 'plm-systm-sim-state', version: 1, savedAt: AT });
    for (const key of ['lastError', 'lastWarning', 'exportPreflight', 'pendingCurrentSnapshot']) expect(saved.state).not.toHaveProperty(key);
    expect(parseSavedState(JSON.stringify(saved)).lastError).toBeNull();
  });

  it.each([
    ['not JSON', () => '{', /JSONとして読めません/],
    ['another kind', (s: AppState) => mutate(s, (r) => (r.kind = 'production-system-sim-scenario')), /種類が違います/],
    ['another version', (s: AppState) => mutate(s, (r) => (r.version = 2)), /版が違います/],
    ['an unknown top-level key', (s: AppState) => mutate(s, (r) => ((r.state as Record<string, unknown>).extra = 1)), /未知の項目があります（extra）/],
    ['a missing key', (s: AppState) => mutate(s, (r) => delete (r.state as Record<string, unknown>).operations), /項目が足りません（operations）/],
    ['a wrong type in a row', (s: AppState) => mutate(s, (r) => ((r.state as AppState).bomLines[0].qtyPer = '1' as unknown as number)), /bomLines\[0\]\.qtyPer が不正です/],
    ['a duplicate id', (s: AppState) => mutate(s, (r) => (r.state as AppState).items.push((r.state as AppState).items[0])), /itemId「.+」が重複しています/],
    [
      'a resource pointing to a missing operation',
      (s: AppState) => mutate(s, (r) => ((r.state as AppState).operationResources[0].opCode = 'OP99')),
      /存在しない工程を指しています/,
    ],
    [
      'a BOM line whose origin change is missing',
      (s: AppState) => mutate(s, (r) => ((r.state as AppState).bomLines.find((l) => l.changeId)!.changeId = 'ECR-404')),
      /\.changeId が存在しない変更を指しています/,
    ],
    [
      'a BOM line whose end change is missing',
      (s: AppState) => mutate(s, (r) => ((r.state as AppState).bomLines.find((l) => l.endChangeId)!.endChangeId = 'ECR-404')),
      /\.endChangeId が存在しない変更を指しています/,
    ],
    [
      'a cycle in the M-BOM recorded when a change was raised',
      (s: AppState) =>
        mutate(s, (r) => {
          const line = (r.state as AppState).bomLines[0];
          (r.state as AppState).changes[0].beforeBomLines = [
            { ...line, bomLineId: 'B1', bomType: 'M', parentItemId: 'X', childItemId: 'Y' },
            { ...line, bomLineId: 'B2', bomType: 'M', parentItemId: 'Y', childItemId: 'X' },
          ];
        }),
      /changes\[0\]\.beforeBomLines：循環参照を検出しました/,
    ],
    ['a malformed approval', (s: AppState) => mutate(s, (r) => ((r.state as AppState).changes[0].approvals = [null as never])), /changes\[0\]\.approvals が不正です/],
    [
      'a duplicate resource id',
      (s: AppState) => mutate(s, (r) => (r.state as AppState).operationResources.push((r.state as AppState).operationResources[0])),
      /resourceId「.+」が重複しています/,
    ],
    [
      'a cycle through a line that ends in the future',
      (s: AppState) =>
        mutate(s, (r) => {
          const st = r.state as AppState;
          const line = st.bomLines.find((l) => l.bomType === 'E' && l.effectiveToDay === undefined && l.parentItemId === 'SA-820')!;
          line.effectiveToDay = st.currentDay + 9;
          st.bomLines.push({ ...line, bomLineId: 'CYCLE', parentItemId: line.childItemId, childItemId: 'SA-820', effectiveToDay: undefined });
        }),
      /E-BOM：循環参照を検出しました/,
    ],
    [
      'a BOM cycle',
      (s: AppState) =>
        mutate(s, (r) => {
          const line = (r.state as AppState).bomLines.find((l) => l.bomType === 'E' && l.effectiveToDay === undefined && l.parentItemId === 'SA-820')!;
          (r.state as AppState).bomLines.push({ ...line, bomLineId: 'CYCLE', parentItemId: line.childItemId, childItemId: 'SA-820' });
        }),
      /E-BOM：循環参照を検出しました/,
    ],
    ['a broken sync session', (s: AppState) => mutate(s, (r) => ((r.state as { syncSession: { touchedBomKeys: unknown } }).syncSession.touchedBomKeys = {})), /syncSession の記録が不正です/],
  ])('rejects %s with a reason', (_name, build, reason) => {
    expect(() => parseSavedState(build(richState()))).toThrow(reason);
  });

  it('accepts unknown keys inside rows (only the top level is strict)', () => {
    const json = mutate(createWoodenChairDemoState(), (r) => ((r.state as AppState).items[0] as unknown as Record<string, unknown>).note = 'x');
    expect(() => parseSavedState(json)).not.toThrow();
  });
});

describe('loadSavedState / saveState / settings', () => {
  it('starts fresh when nothing is saved, and restores what was saved', () => {
    const storage = memoryStorage();
    expect(loadSavedState(storage)).toEqual({ kind: 'fresh' });
    const state = richState();
    expect(saveState(storage, state, AT)).toBeNull();
    const boot = loadSavedState(storage);
    expect(boot.kind).toBe('restored');
    expect(boot.kind === 'restored' && boot.state.bomLines).toEqual(state.bomLines);
  });

  it('moves broken data aside and reports the reason', () => {
    const storage = memoryStorage({ [STATE_KEY]: '{"kind":"plm-systm-sim-state","version":9}' });
    expect(loadSavedState(storage)).toEqual({ kind: 'broken', reason: expect.stringMatching(/版が違います/) });
    expect(storage.data[BROKEN_KEY]).toBe('{"kind":"plm-systm-sim-state","version":9}');
    expect(storage.data[STATE_KEY]).toBeUndefined();
  });

  it('is on by default; turning it off deletes the saved data and ignores it on the next start', () => {
    const storage = memoryStorage();
    expect(readSettings(storage)).toEqual({ enabled: true });
    saveState(storage, createWoodenChairDemoState(), AT);
    setPersistenceEnabled(storage, false);
    expect(readSettings(storage)).toEqual({ enabled: false });
    expect(storage.data[STATE_KEY]).toBeUndefined();
    expect(JSON.parse(storage.data[SETTINGS_KEY])).toEqual({ enabled: false });
    expect(loadSavedState(storage)).toEqual({ kind: 'fresh' });
  });

  it('reports a storage that cannot be used, and a save that fails, without throwing', () => {
    expect(loadSavedState(null).kind).toBe('unavailable');
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(loadSavedState(throwing)).toEqual({ kind: 'unavailable', reason: expect.stringContaining('denied') });
    expect(saveState(throwing, createWoodenChairDemoState(), AT)).toMatch(/保存できませんでした.*詳細：QuotaExceededError/);
  });
});

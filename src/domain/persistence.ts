// localStorage への保存と、検証つきの読み込み（拡張仕様 v2.0 E4、design.md PLM-EXT-24）。
// 直列化・検証は状態を変えない関数。ブラウザの localStorage は引数（KeyValueStorage）で受け、テストでは差し替える。
import { detectBomCycles, parseMasterSnapshot } from './masterSnapshot';
import type { AppState } from './reducer';
import type { SyncSession } from './types';

export const STATE_KEY = 'plm-systm-sim:state';
export const SETTINGS_KEY = 'plm-systm-sim:settings';
export const BROKEN_KEY = 'plm-systm-sim:broken';
export const SAVED_KIND = 'plm-systm-sim-state';
export const SAVED_VERSION = 1;

export class PersistenceError extends Error {}

// localStorage のうち使う部分。アクセスそのものが例外を投げることがある（プライベートモード等）
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// 保存しない一時的な値（エラー表示・書き出しの確認中だけ使う値）
type TransientKey = 'lastError' | 'lastWarning' | 'exportPreflight' | 'pendingCurrentSnapshot';
type SavedState = Omit<AppState, TransientKey | 'syncSession'> & { syncSession: SavedSyncSession | null };
type SavedSyncSession = Omit<SyncSession, 'touchedItemIds' | 'touchedBomKeys' | 'touchedRoutingItemIds'> & {
  touchedItemIds: string[];
  touchedBomKeys: string[];
  touchedRoutingItemIds: string[];
};

// 保存する項目と保存しない項目を、AppState の全項目について型で網羅させる。
// AppState に項目を足すと、ここに足すまで型エラーになる（保存漏れを防ぐ）
const STATE_FIELDS: Record<keyof AppState, 'persisted' | 'transient'> = {
  currentDay: 'persisted',
  items: 'persisted',
  bomLines: 'persisted',
  changes: 'persisted',
  documents: 'persisted',
  configurations: 'persisted',
  operations: 'persisted',
  operationResources: 'persisted',
  passthrough: 'persisted',
  alternateOverrides: 'persisted',
  syncSession: 'persisted',
  syncEvents: 'persisted',
  idCounter: 'persisted',
  lastError: 'transient',
  lastWarning: 'transient',
  exportPreflight: 'transient',
  pendingCurrentSnapshot: 'transient',
};
const PERSISTED_KEYS = (Object.keys(STATE_FIELDS) as (keyof AppState)[]).filter((k) => STATE_FIELDS[k] === 'persisted');

export function toSavedState(state: AppState): SavedState {
  const saved = {} as Record<string, unknown>;
  for (const key of PERSISTED_KEYS) saved[key] = state[key];
  const s = state.syncSession;
  saved.syncSession = s
    ? {
        ...s,
        touchedItemIds: [...s.touchedItemIds],
        touchedBomKeys: [...s.touchedBomKeys],
        touchedRoutingItemIds: [...s.touchedRoutingItemIds],
      }
    : null;
  return saved as SavedState;
}

export function serializeState(state: AppState, savedAt: string): string {
  return JSON.stringify({ kind: SAVED_KIND, version: SAVED_VERSION, savedAt, state: toSavedState(state) });
}

// ---- 検査 ----

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isDay = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const BOM_LINE_FIELDS: Record<string, (v: unknown) => boolean> = {
  bomLineId: isString,
  parentItemId: isString,
  childItemId: isString,
  qtyPer: isNumber,
  bomType: (v) => v === 'E' || v === 'M',
  version: isNumber,
  effectiveFromDay: isDay,
  effectiveToDay: optional(isDay),
};

function fail(message: string): never {
  throw new PersistenceError(message);
}

function rows(raw: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = raw[key];
  if (!Array.isArray(value)) fail(`${key} が配列ではありません`);
  return value.map((row, i) => (isObject(row) ? row : fail(`${key}[${i}] が不正です`)));
}

function requireFields(table: string, rowsOf: Record<string, unknown>[], checks: Record<string, (v: unknown) => boolean>) {
  rowsOf.forEach((row, i) => {
    for (const [field, ok] of Object.entries(checks)) {
      if (!ok(row[field])) fail(`${table}[${i}].${field} が不正です`);
    }
  });
}


function uniqueIds(table: string, rowsOf: Record<string, unknown>[], field: string) {
  const seen = new Set<unknown>();
  for (const row of rowsOf) {
    if (seen.has(row[field])) fail(`${table} の ${field}「${String(row[field])}」が重複しています`);
    seen.add(row[field]);
  }
}

// 保存データを検査して状態に戻す。最上位のキーは厳しく（未知・欠けを拒否）、行の中は必須項目の型と参照だけを見る
export function parseSavedState(json: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail('JSONとして読めません');
  }
  if (!isObject(parsed)) fail('保存データの形式が不正です');
  if (parsed.kind !== SAVED_KIND) fail(`保存データの種類が違います（${String(parsed.kind)}）`);
  if (parsed.version !== SAVED_VERSION) fail(`保存データの版が違います（${String(parsed.version)}。この画面は版${SAVED_VERSION}だけを読めます）`);
  const raw = parsed.state;
  if (!isObject(raw)) fail('state がありません');

  const unknown = Object.keys(raw).filter((k) => !(PERSISTED_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) fail(`未知の項目があります（${unknown.join('、')}）`);
  const missing = PERSISTED_KEYS.filter((k) => !(k in raw));
  if (missing.length > 0) fail(`項目が足りません（${missing.join('、')}）`);

  if (!isDay(raw.currentDay)) fail('currentDay が不正です');
  if (!isDay(raw.idCounter)) fail('idCounter が不正です');

  const items = rows(raw, 'items');
  requireFields('items', items, { itemId: isString, name: isString, lifecycleStatus: isString });
  uniqueIds('items', items, 'itemId');

  const bomLines = rows(raw, 'bomLines');
  requireFields('bomLines', bomLines, BOM_LINE_FIELDS);
  uniqueIds('bomLines', bomLines, 'bomLineId');

  const changes = rows(raw, 'changes');
  requireFields('changes', changes, {
    changeId: isString,
    type: isString,
    status: isString,
    impactedItemIds: stringArray,
    impactedBomLineIds: stringArray,
    approvals: (v) => Array.isArray(v) && v.every((a) => isObject(a) && isString(a.approverRole) && isString(a.decision)),
    requiredApproverRoles: optional(stringArray),
  });
  uniqueIds('changes', changes, 'changeId');
  // 起票時点のM-BOM（PLM-EXT-14）。原価影響の計算で再帰的に辿るので、行の型と循環も見る
  changes.forEach((c, i) => {
    if (c.beforeBomLines === undefined) return;
    const before = rows(c, 'beforeBomLines');
    requireFields(`changes[${i}].beforeBomLines`, before, BOM_LINE_FIELDS);
    const cycles = detectBomCycles(before as unknown as Parameters<typeof detectBomCycles>[0]);
    if (cycles.length > 0) fail(`changes[${i}].beforeBomLines：${cycles[0]}`);
  });

  requireFields('documents', rows(raw, 'documents'), { docId: isString, version: isNumber, relatedItemId: isString });
  const configurations = rows(raw, 'configurations');
  requireFields('configurations', configurations, { configId: isString, baseItemId: isString, resolvedItemId: isString, selections: isObject });
  uniqueIds('configurations', configurations, 'configId');

  const operations = rows(raw, 'operations');
  requireFields('operations', operations, {
    operationId: isString,
    itemId: isString,
    opCode: isString,
    stepNo: isNumber,
    name: isString,
    workCenter: isString,
    stdTimeMin: isNumber,
    version: isNumber,
    effectiveFromDay: isDay,
    effectiveToDay: optional(isDay),
  });
  uniqueIds('operations', operations, 'operationId');

  const resources = rows(raw, 'operationResources');
  requireFields('operationResources', resources, { resourceId: isString, itemId: isString, opCode: isString, kind: isString, code: isString, name: isString });
  uniqueIds('operationResources', resources, 'resourceId');

  const syncEvents = rows(raw, 'syncEvents');
  requireFields('syncEvents', syncEvents, { eventId: isString, status: isString, exportedAtDay: isDay, sourceChangeId: optional(isString) });
  uniqueIds('syncEvents', syncEvents, 'eventId');

  const passthrough = raw.passthrough;
  if (!isObject(passthrough)) fail('passthrough が不正です');
  for (const key of ['workCenters', 'customers', 'suppliers']) rows(passthrough, key);

  if (!isObject(raw.alternateOverrides) || !Object.values(raw.alternateOverrides).every(isString)) {
    fail('alternateOverrides が不正です');
  }

  // 参照の整合：資源は工程を（品目、工程コード）で指す。BOM行の親子・工程は品目を、変更の由来は登録済みの変更を指す
  // BOM行の親子と工程は品目を指す。E-BOM限定グループ（脚部ユニット等）は品目マスタに登録しないので、
  // グループが親・子になる行は除く（グループ＝isEbomOnly の行の親。PLM-EXT-2）
  const itemIds = new Set(items.map((it) => it.itemId));
  const groups = new Set(bomLines.filter((l) => l.isEbomOnly === true).map((l) => l.parentItemId));
  bomLines.forEach((l, i) => {
    for (const field of ['parentItemId', 'childItemId']) {
      if (!groups.has(l[field]) && !itemIds.has(l[field])) fail(`bomLines[${i}].${field}「${String(l[field])}」が存在しない品目を指しています`);
    }
  });
  operations.forEach((o, i) => {
    if (!itemIds.has(o.itemId)) fail(`operations[${i}].itemId「${String(o.itemId)}」が存在しない品目を指しています`);
  });
  const opKeys = new Set(operations.map((o) => `${String(o.itemId)}::${String(o.opCode)}`));
  resources.forEach((r, i) => {
    if (!opKeys.has(`${String(r.itemId)}::${String(r.opCode)}`)) fail(`operationResources[${i}] が存在しない工程を指しています`);
  });
  const changeIds = new Set(changes.map((c) => c.changeId));
  bomLines.forEach((l, i) => {
    for (const field of ['changeId', 'endChangeId']) {
      if (l[field] !== undefined && !changeIds.has(l[field])) fail(`bomLines[${i}].${field} が存在しない変更を指しています`);
    }
  });

  // BOM の循環（三重防御の②と同じ考え方）。今日以降に有効な行（終了していない行・終了予定の行）を、
  // E-BOM・M-BOM別に調べる
  const today = raw.currentDay;
  for (const bomType of ['E', 'M']) {
    const current = bomLines.filter((l) => l.bomType === bomType && (l.effectiveToDay === undefined || (l.effectiveToDay as number) > today));
    const cycles = detectBomCycles(current as unknown as Parameters<typeof detectBomCycles>[0]);
    if (cycles.length > 0) fail(`${bomType}-BOM：${cycles[0]}`);
  }

  let syncSession: SyncSession | null = null;
  if (raw.syncSession !== null) {
    const s = raw.syncSession;
    if (!isObject(s) || !isDay(s.importedAtDay)) fail('syncSession が不正です');
    if (!stringArray(s.touchedItemIds) || !stringArray(s.touchedBomKeys) || !stringArray(s.touchedRoutingItemIds)) {
      fail('syncSession の記録が不正です');
    }
    let baseline;
    try {
      baseline = parseMasterSnapshot(s.baseline);
    } catch (e) {
      fail(`syncSession.baseline：${(e as Error).message}`);
    }
    syncSession = {
      importedAtDay: s.importedAtDay,
      baseline,
      touchedItemIds: new Set(s.touchedItemIds),
      touchedBomKeys: new Set(s.touchedBomKeys),
      touchedRoutingItemIds: new Set(s.touchedRoutingItemIds),
    };
  }

  return {
    ...(raw as unknown as Omit<AppState, TransientKey | 'syncSession'>),
    syncSession,
    exportPreflight: null,
    pendingCurrentSnapshot: null,
    lastError: null,
    lastWarning: null,
  };
}

// ---- 保存先とのやりとり（例外は投げず、結果で返す） ----

export interface PersistenceSettings {
  enabled: boolean; // 既定はオン（所有者決定 Q1）
}

export function readSettings(storage: KeyValueStorage | null): PersistenceSettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { enabled: true };
    const parsed: unknown = JSON.parse(raw);
    return { enabled: !(isObject(parsed) && parsed.enabled === false) };
  } catch {
    return { enabled: true };
  }
}

export type BootResult =
  | { kind: 'restored'; state: AppState }
  | { kind: 'fresh' } // 保存データなし（または保存しない設定）。サンプルで起動する
  | { kind: 'broken'; reason: string } // 読めなかった。データは BROKEN_KEY へ退避済み
  | { kind: 'unavailable'; reason: string }; // localStorage が使えない

export function loadSavedState(storage: KeyValueStorage | null): BootResult {
  if (!storage) return { kind: 'unavailable', reason: 'このブラウザでは保存領域（localStorage）を使えません' };
  if (!readSettings(storage).enabled) return { kind: 'fresh' };
  let raw: string | null;
  try {
    raw = storage.getItem(STATE_KEY);
  } catch (e) {
    return { kind: 'unavailable', reason: `保存領域を読めません（${(e as Error).message}）` };
  }
  if (raw === null) return { kind: 'fresh' };
  try {
    return { kind: 'restored', state: parseSavedState(raw) };
  } catch (e) {
    const reason = e instanceof PersistenceError ? e.message : `読み込みに失敗しました（${(e as Error).message}）`;
    // 上書きされる前に退避する（所有者決定 Q2）。退避に失敗しても起動は続ける
    try {
      storage.setItem(BROKEN_KEY, raw);
      storage.removeItem(STATE_KEY);
    } catch {
      /* 退避できなくても、サンプルでの起動は続ける */
    }
    return { kind: 'broken', reason };
  }
}

// 保存する。書けなかったときは理由を返す（容量超過など）
export function saveState(storage: KeyValueStorage, state: AppState, savedAt: string): string | null {
  try {
    storage.setItem(STATE_KEY, serializeState(state, savedAt));
    return null;
  } catch (e) {
    return `このブラウザに保存できませんでした（保存領域の容量不足などが考えられます）。このタブでは保存を止めています。不要なデータを消してから「このブラウザに保存する」を外して入れ直すと、保存し直します（詳細：${(e as Error).message}）`;
  }
}

// 保存のオン・オフ。オフにすると保存済みのデータを消す
export function setPersistenceEnabled(storage: KeyValueStorage, enabled: boolean): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ enabled }));
    if (!enabled) storage.removeItem(STATE_KEY);
  } catch {
    /* 設定を書けなくても画面の操作は続ける */
  }
}

// 保存データを退避して消す（保存データから再開した画面が例外で止まったときの逃げ道。ErrorBoundary から使う）
export function quarantineSavedState(storage: KeyValueStorage | null): void {
  try {
    const raw = storage?.getItem(STATE_KEY);
    if (storage && raw) {
      storage.setItem(BROKEN_KEY, raw);
      storage.removeItem(STATE_KEY);
    }
  } catch {
    /* 退避できなくても続ける */
  }
}

export function clearSavedState(storage: KeyValueStorage): void {
  try {
    storage.removeItem(STATE_KEY);
  } catch {
    /* 消せなくても続ける */
  }
}

export function readBrokenData(storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(BROKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function discardBrokenData(storage: KeyValueStorage): void {
  try {
    storage.removeItem(BROKEN_KEY);
  } catch {
    /* 消せなくても続ける */
  }
}

export function readSavedJson(storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(STATE_KEY) ?? null;
  } catch {
    return null;
  }
}

// 保存データの savedAt（復元したときに最終保存の時刻を最初から表示する）
export function savedAtOf(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) && typeof parsed.savedAt === 'string' ? parsed.savedAt : null;
  } catch {
    return null;
  }
}

// 状態の自動保存（design.md PLM-EXT-24・25）。保存の判定・形式はドメイン（persistence.ts）に任せ、
// ここではタイミング（0.5秒まとめ、タブを閉じる・隠すときの書き出し）と、別のタブでの保存・設定変更の検知だけを持つ。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SETTINGS_KEY,
  STATE_KEY,
  clearSavedState,
  readSettings,
  saveState,
  setPersistenceEnabled,
  type KeyValueStorage,
} from '../domain/persistence';
import type { AppState } from '../domain/reducer';

const SAVE_DELAY_MS = 500;

// localStorage を使えるか試す。使えなければ null（プライベートモードやサイトデータの遮断）
export function browserStorage(): KeyValueStorage | null {
  try {
    const storage = window.localStorage;
    const probe = 'plm-systm-sim:probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export interface Persistence {
  enabled: boolean;
  available: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  otherTabSaved: boolean; // 別のタブが保存した
  turnedOffByOtherTab: boolean; // 別のタブで保存がオフにされた
  setEnabled: (enabled: boolean) => void;
  dismissOtherTabNotice: () => void;
  restartWithSample: () => void; // 保存を消して再読み込み（サンプルで起動）
  reloadFromOtherTab: () => void; // このタブの未保存分を書かずに再読み込み（別のタブの内容を読む）
}

export function usePersistence(storage: KeyValueStorage | null, state: AppState, initiallyEnabled: boolean): Persistence {
  const [enabled, setEnabledState] = useState(initiallyEnabled && storage !== null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [otherTabSaved, setOtherTabSaved] = useState(false);
  const [turnedOffByOtherTab, setTurnedOffByOtherTab] = useState(false);
  const pending = useRef<AppState | null>(null);
  const leaving = useRef(false); // 再読み込みの直前は書き出さない
  const initialState = useRef(state); // 起動した状態のままなら保存しない（開いただけで別のタブに警告を出さない）
  const latest = useRef(state);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    latest.current = state;
    enabledRef.current = enabled;
  });

  const flush = useCallback(() => {
    if (!storage || !pending.current || leaving.current) return;
    const at = new Date().toISOString();
    const error = saveState(storage, pending.current, at);
    pending.current = null;
    if (error) setSaveError(error);
    else setLastSavedAt(at);
  }, [storage]);

  // 状態が変わったら、0.5秒まとめてから保存する。書けなかったら、このタブでは保存をやめる
  useEffect(() => {
    if (!enabled || saveError || !storage || state === initialState.current) return;
    pending.current = state;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, enabled, saveError, storage, flush]);

  // まとめている間にタブを閉じる・隠すと最後の操作が残らないので、その時点で書き出す
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  // 別のタブでの保存（後勝ち。所有者決定 Q4）と、保存のオフを検知する。
  // オフにされたら、このタブも保存をやめる（消した保存データを書き戻さない）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STATE_KEY && e.newValue !== null) setOtherTabSaved(true);
      if (e.key === SETTINGS_KEY && !readSettings(storage).enabled) {
        pending.current = null;
        if (enabledRef.current) setTurnedOffByOtherTab(true);
        setEnabledState(false);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storage]);

  const setEnabled = (next: boolean) => {
    if (!storage) return;
    pending.current = null;
    setPersistenceEnabled(storage, next);
    setEnabledState(next);
    setSaveError(null);
    setLastSavedAt(null);
    setTurnedOffByOtherTab(false);
    if (next) {
      // 入れたらすぐ今の内容を保存する
      pending.current = latest.current;
      flush();
    }
  };

  const leave = (beforeReload?: () => void) => {
    leaving.current = true;
    pending.current = null;
    beforeReload?.();
    window.location.reload();
  };

  return {
    enabled,
    available: storage !== null,
    lastSavedAt,
    saveError,
    otherTabSaved,
    turnedOffByOtherTab,
    setEnabled,
    dismissOtherTabNotice: () => setOtherTabSaved(false),
    restartWithSample: () => leave(() => storage && clearSavedState(storage)),
    reloadFromOtherTab: () => leave(),
  };
}

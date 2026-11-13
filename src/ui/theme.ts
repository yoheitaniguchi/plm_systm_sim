// 画面のテーマ（ライト／ダーク）の選択と保存（design.md PLM-EXT-26）。
// テーマは見た目の好みで演習の状態ではないので、状態の保存（PLM-EXT-24・25）のオン・オフとは連動させず、
// 別のキーに常に保存する（所有者決定 2026-11-13）。「保存を消してサンプルで始め直す」でも消さない。
// 描画前の適用は index.html のインラインスクリプトが同じキー・同じ規則で行う（読み込み直後に白く光らないように）。
import type { KeyValueStorage } from '../domain/persistence';

export const THEME_KEY = 'plm-systm-sim:theme';

/** 利用者の選択。system は OS の設定（prefers-color-scheme）に従う */
export type ThemePreference = 'system' | 'light' | 'dark';
/** 実際に当てるテーマ */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'OSに合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];

/** 保存値を読む。未知の値・読めない値は「OSに合わせる」として扱う */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** 保存先が使えない・読めないときは「OSに合わせる」。例外は投げない */
export function readThemePreference(storage: KeyValueStorage | null): ThemePreference {
  if (!storage) return 'system';
  try {
    return parseThemePreference(storage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** 保存できたかを返す。保存先が使えなくても切り替え自体はそのタブで効く */
export function writeThemePreference(storage: KeyValueStorage | null, preference: ThemePreference): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

// ヘッダーのテーマ切り替え（design.md PLM-EXT-26）。
// <html data-theme> に実際のテーマ（light / dark）を当て、CSS はその属性で色の変数を切り替える。
import { useEffect, useState } from 'react';
import type { KeyValueStorage } from '../../domain/persistence';
import {
  THEME_KEY,
  THEME_OPTIONS,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemePreference,
} from '../theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeSwitcher({ storage }: { storage: KeyValueStorage | null }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference(storage));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // OS の設定が変わったら追従する（「OSに合わせる」のときに効く）
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // 別のタブで選び直したら、このタブも合わせる
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setPreference(parseThemePreference(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return (
    <label className="theme-switcher">
      表示：
      <select
        value={preference}
        onChange={(e) => {
          const next = parseThemePreference(e.target.value);
          setPreference(next);
          writeThemePreference(storage, next);
        }}
      >
        {THEME_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

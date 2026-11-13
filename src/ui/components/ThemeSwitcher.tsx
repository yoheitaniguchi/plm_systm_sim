// ヘッダーのテーマ切り替え（design.md PLM-EXT-26）。
// <html data-theme> に実際のテーマ（light / dark）を当て、CSS はその属性で色の変数を切り替える。
import { useEffect, useState, type ReactNode } from 'react';
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

// ボタンのアイコン（所有者の要望：OSに合わせる＝PC、ライト＝太陽、ダーク＝月）。線の色は文字色に合わせる
const ICON_PATHS: Record<ThemePreference, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
};

function ThemeIcon({ value }: { value: ThemePreference }) {
  return (
    <svg
      className="theme-switcher__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[value]}
    </svg>
  );
}

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

  const choose = (next: ThemePreference) => {
    setPreference(next);
    writeThemePreference(storage, next);
  };

  // 3つ並びのアイコンボタン。押されているものを aria-pressed で示す（所有者の要望：ボタンで切り替える、アイコンにする）。
  // 名前は aria-label で読み上げ、title でマウスを載せたときにも出す
  return (
    <div className="theme-switcher" role="group" aria-label="表示テーマ">
      <span aria-hidden="true">表示：</span>
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-switcher__button${preference === option.value ? ' theme-switcher__button--active' : ''}`}
          aria-pressed={preference === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => choose(option.value)}
        >
          <ThemeIcon value={option.value} />
        </button>
      ))}
    </div>
  );
}

// テーマ切り替え（design.md PLM-EXT-26）
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../../domain/persistence';
import { STATE_KEY, clearSavedState, setPersistenceEnabled } from '../../domain/persistence';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { THEME_KEY, parseThemePreference, readThemePreference, resolveTheme, writeThemePreference } from '../theme';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {},
};

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe('テーマの選択の読み書き', () => {
  it('未知の値・空は「OSに合わせる」として読む', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });

  it('「OSに合わせる」は OS の設定で、明示の選択は OS に関係なく決まる', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('保存先が使えなくても例外を投げない', () => {
    expect(readThemePreference(null)).toBe('system');
    expect(readThemePreference(throwingStorage)).toBe('system');
    expect(writeThemePreference(null, 'dark')).toBe(false);
    expect(writeThemePreference(throwingStorage, 'dark')).toBe(false);
  });

  it('状態の保存をオフにしても、保存を消しても、テーマの選択は残る（所有者決定：連動させない）', () => {
    const storage = memoryStorage({ [STATE_KEY]: '{}' });
    writeThemePreference(storage, 'dark');
    setPersistenceEnabled(storage, false);
    clearSavedState(storage);
    expect(storage.data.has(STATE_KEY)).toBe(false);
    expect(readThemePreference(storage)).toBe('dark');
  });
});

describe('ThemeSwitcher', () => {
  it('選んだテーマを <html data-theme> に当てて保存する', () => {
    const storage = memoryStorage();
    render(<ThemeSwitcher storage={storage} />);
    expect(screen.getByRole('button', { name: 'OSに合わせる' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light'); // jsdom には OS のダーク設定が無い

    fireEvent.click(screen.getByRole('button', { name: 'ダーク' }));
    expect(screen.getByRole('button', { name: 'ダーク' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'OSに合わせる' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storage.data.get(THEME_KEY)).toBe('dark');
  });

  it('保存済みの選択で始まり、別のタブで選び直したら合わせる', () => {
    const storage = memoryStorage({ [THEME_KEY]: 'dark' });
    render(<ThemeSwitcher storage={storage} />);
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }));
    });
    expect(screen.getByRole('button', { name: 'ライト' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

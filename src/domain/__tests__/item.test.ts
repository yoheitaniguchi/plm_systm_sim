import { describe, expect, it } from 'vitest';
import { advanceLifecycleStatus, createItem, generateNewItemCode, renameItemCode } from '../item';
import type { PlmItem } from '../types';

describe('item domain', () => {
  // UC-ITEM-1
  it('creates a new item with lifecycleStatus "試作"', () => {
    const items: PlmItem[] = [];
    const item = createItem(items, { itemId: 'FG-900', name: 'テスト品目', makeBuy: 'MAKE', leadTimeDays: 1 });
    expect(item.lifecycleStatus).toBe('試作');
    expect(items).toHaveLength(1);
  });

  it('rejects creating an item with a duplicate itemId', () => {
    const items: PlmItem[] = [{ itemId: 'FG-900', name: 'x', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '試作' }];
    expect(() => createItem(items, { itemId: 'FG-900', name: 'y', makeBuy: 'MAKE', leadTimeDays: 1 })).toThrow();
  });

  // UC-ITEM-2
  it('advances lifecycle from 試作 to 設計確定 only (no skipping)', () => {
    const items: PlmItem[] = [{ itemId: 'FG-900', name: 'x', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '試作' }];
    advanceLifecycleStatus(items, 'FG-900', '設計確定');
    expect(items[0].lifecycleStatus).toBe('設計確定');

    expect(() => advanceLifecycleStatus(items, 'FG-900', '量産')).toThrow();
  });

  // UC-ITEM-3
  it('rejects moving backwards from 量産 to 試作', () => {
    const items: PlmItem[] = [{ itemId: 'FG-900', name: 'x', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' }];
    expect(() => advanceLifecycleStatus(items, 'FG-900', '試作')).toThrow();
  });

  // UC-ITEM-4
  it('rejects changing the item code after creation (EXT-24)', () => {
    const items: PlmItem[] = [{ itemId: 'FG-100', name: 'x', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' }];
    expect(() => renameItemCode(items, 'FG-100', 'FG-999')).toThrow();
  });

  // 4.3: 新規品目コードの採番
  it('generates the next free code in the derived-from number band', () => {
    const existing = new Set(['FG-100']);
    expect(generateNewItemCode('FG', 'FG-100', existing)).toBe('FG-101');
  });

  it('skips numbers that are already taken when generating a new code', () => {
    const existing = new Set(['FG-100', 'FG-101', 'FG-102']);
    expect(generateNewItemCode('FG', 'FG-100', existing)).toBe('FG-103');
  });
});

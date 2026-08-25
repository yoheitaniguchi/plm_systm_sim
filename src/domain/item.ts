// 品目（Item）ドメイン：品目マスタ、ライフサイクルステータス（3章#1、6.1）。
import type { ItemCodePrefix, ItemLifecycleStatus, PlmItem } from './types';

// 6.1: 品目ライフサイクルステータスの状態遷移（一方向のみ、後戻り不可）。
const LIFECYCLE_ORDER: ItemLifecycleStatus[] = [
  '試作',
  '設計確定',
  '量産準備中',
  '量産',
  '保守専用',
  '廃止',
];

export function canAdvanceLifecycle(
  from: ItemLifecycleStatus,
  to: ItemLifecycleStatus,
): boolean {
  const fromIdx = LIFECYCLE_ORDER.indexOf(from);
  const toIdx = LIFECYCLE_ORDER.indexOf(to);
  return toIdx === fromIdx + 1;
}

// UIで「次に進められるステータス」を表示するためのヘルパー。廃止からは先が無い。
export function nextLifecycleStatus(from: ItemLifecycleStatus): ItemLifecycleStatus | undefined {
  return LIFECYCLE_ORDER[LIFECYCLE_ORDER.indexOf(from) + 1];
}

// UC-ITEM-1: 新規品目は「試作」で作成される。
export function createItem(
  items: PlmItem[],
  input: Omit<PlmItem, 'lifecycleStatus'> & { lifecycleStatus?: ItemLifecycleStatus },
): PlmItem {
  if (items.some((i) => i.itemId === input.itemId)) {
    throw new Error(`品目コード ${input.itemId} は既に登録されています`);
  }
  const item: PlmItem = { ...input, lifecycleStatus: input.lifecycleStatus ?? '試作' };
  items.push(item);
  return item;
}

// UC-ITEM-2/3: 「試作→設計確定→量産準備中→量産→保守専用→廃止」の一方向遷移のみ許可。
export function advanceLifecycleStatus(
  items: PlmItem[],
  itemId: string,
  to: ItemLifecycleStatus,
): PlmItem {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) throw new Error(`品目 ${itemId} が見つかりません`);
  if (!canAdvanceLifecycle(item.lifecycleStatus, to)) {
    throw new Error(
      `品目 ${itemId} のステータスを「${item.lifecycleStatus}」から「${to}」へ遷移できません`,
    );
  }
  item.lifecycleStatus = to;
  return item;
}

// 品目コード以外の属性を更新する。品目コード（itemId）自体はこの型から除外されており
// 変更できない（EXT-24踏襲、UC-ITEM-4）。
export function updateItem(
  items: PlmItem[],
  itemId: string,
  patch: Partial<Omit<PlmItem, 'itemId' | 'lifecycleStatus'>>,
): PlmItem {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) throw new Error(`品目 ${itemId} が見つかりません`);
  Object.assign(item, patch);
  return item;
}

// UC-ITEM-4: 品目コードの変更は明示的に拒否する。改名したい場合は削除→再登録のみ。
export function renameItemCode(_items: PlmItem[], _itemId: string, _newItemId: string): never {
  throw new Error('品目コードは作成後に変更できません（削除して再登録してください）');
}

export function deleteItem(items: PlmItem[], itemId: string): void {
  const idx = items.findIndex((i) => i.itemId === itemId);
  if (idx === -1) throw new Error(`品目 ${itemId} が見つかりません`);
  items.splice(idx, 1);
}

// 4.3: 新規品目コードの採番（PLM側が発番、Rev.H）。
// 派生元品目の番号帯の次の空き番号を割り当てる簡易ルール。
export function generateNewItemCode(
  prefix: ItemCodePrefix,
  derivedFromItemId: string,
  existingItemIds: Set<string>,
): string {
  const baseNum = parseInt(derivedFromItemId.replace(/^[A-Z]+-/, ''), 10);
  let candidate = baseNum + 1;
  while (existingItemIds.has(`${prefix}-${candidate}`)) {
    candidate += 1;
  }
  return `${prefix}-${candidate}`;
}

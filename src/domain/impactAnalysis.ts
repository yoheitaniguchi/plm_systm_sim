// 影響分析（Impact）ドメイン：BOM逆展開、変更影響トレーサビリティ、原価影響（3章#7、7.1、7.7）。
import { MAX_BOM_DEPTH } from './types';
import type { BomType, EngineeringChange, PlmBomLine, PlmItem } from './types';

export { MAX_BOM_DEPTH };

export function isEffectiveAsOf(line: PlmBomLine, day: number): boolean {
  const afterStart = line.effectiveFromDay <= day;
  const beforeEnd = line.effectiveToDay === undefined || day < line.effectiveToDay;
  return afterStart && beforeEnd;
}

// 発注BOM・計画BOM共通：対象品目がまだM-BOMへ変換されていない（E-BOMのみ存在する）場合に拒否する。
// PLM-EXT-13の両機能とも「確定済みM-BOMのみを対象とする」前提のため、未変換のまま渡されると
// 結果が無言で空になってしまう（ユーザーが真因に気づけない）。bomLinesはE/M混在の配列を渡すこと。
export function assertMbomConverted(topItemId: string, bomLines: PlmBomLine[]): void {
  const hasEbomChildren = bomLines.some(
    (l) => l.bomType === 'E' && l.parentItemId === topItemId && l.effectiveToDay === undefined,
  );
  const hasMbomChildren = bomLines.some((l) => l.bomType === 'M' && l.parentItemId === topItemId);
  if (hasEbomChildren && !hasMbomChildren) {
    throw new Error(
      `品目 ${topItemId} はまだM-BOMへ変換されていません。M-BOMタブで確定済みM-BOMに変換してから実行してください`,
    );
  }
}

// 7.1: BOM逆展開（影響分析、三重防御の第三防御を実装）。
export function whereUsed(
  itemId: string,
  bomLines: PlmBomLine[],
  bomType: BomType,
  asOfDay: number,
): { parentItemId: string; depth: number }[] {
  const results: { parentItemId: string; depth: number }[] = [];

  function walk(childId: string, depth: number, visited: Set<string>) {
    if (depth > MAX_BOM_DEPTH) {
      throw new Error(`BOM階層が深さ上限(${MAX_BOM_DEPTH})を超えました。循環参照の疑いがあります`);
    }
    if (visited.has(childId)) return;
    visited.add(childId);

    const parents = bomLines.filter(
      (l) => l.childItemId === childId && l.bomType === bomType && isEffectiveAsOf(l, asOfDay),
    );

    for (const line of parents) {
      results.push({ parentItemId: line.parentItemId, depth });
      walk(line.parentItemId, depth + 1, visited);
    }
  }

  walk(itemId, 1, new Set());
  return results;
}

// 7.7: 原価影響の簡易算出。購入部品費用（purchasePrice）の積み上げのみを対象とする。
// 内製品目（MAKE）の加工費（作業区の賃率×標準時間）は含まない簡易版。
export function computeRolledUpCost(itemId: string, bomLines: PlmBomLine[], items: PlmItem[]): number {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) return 0;
  if (item.makeBuy === 'BUY') return item.purchasePrice ?? 0;

  const children = bomLines.filter((l) => l.parentItemId === itemId);
  return children.reduce(
    (sum, l) => sum + l.qtyPer * computeRolledUpCost(l.childItemId, bomLines, items),
    0,
  );
  // 注：MAKE品目の加工費は含まない簡易版。将来的に精度を上げる場合は
  // routingSteps（工程）× workCenters.ratePerHour（賃率）で加工費を積み上げる拡張が可能。
}

export function computeCostImpact(
  change: EngineeringChange,
  beforeBom: PlmBomLine[],
  afterBom: PlmBomLine[],
  items: PlmItem[],
): { itemId: string; before: number; after: number; delta: number }[] {
  return change.impactedItemIds.map((itemId) => {
    const before = computeRolledUpCost(itemId, beforeBom, items);
    const after = computeRolledUpCost(itemId, afterBom, items);
    return { itemId, before, after, delta: after - before };
  });
}

// 発注BOM（購買ビュー、新規スコープ、docs/design.md PLM-EXT-13、Issue #8）：
// M-BOMをBUY品目まで展開し、仕入先・単価・リードタイムを集計する読み取り専用レポート。
// mbomLinesは呼び出し側がreducer.effectiveMbomLines()（代替部品グループ解決済み）を
// 渡すことを前提とする。ここでは代替部品の解決は行わない。
export interface PurchaseBomLine {
  itemId: string;
  name: string;
  totalQtyPer: number; // topItemIdからの経路上のqtyPerを掛け合わせた累積必要数（複数経路は合算）
  defaultSupplierId?: string;
  purchasePrice?: number;
  leadTimeDays: number;
  extendedCost: number; // purchasePrice * totalQtyPer
  supplierMissing: boolean; // defaultSupplierId未設定（UC-SYNC-6と同じ判定条件）
}

export function buildPurchaseBom(
  topItemId: string,
  mbomLines: PlmBomLine[],
  items: PlmItem[],
  asOfDay: number,
): PurchaseBomLine[] {
  const totals = new Map<string, number>(); // itemId -> 累積必要数（複数経路は合算）

  function walk(itemId: string, cumulativeQty: number, depth: number, visited: Set<string>) {
    if (depth > MAX_BOM_DEPTH) {
      throw new Error(`BOM階層が深さ上限(${MAX_BOM_DEPTH})を超えました。循環参照の疑いがあります`);
    }
    const children = mbomLines.filter((l) => l.parentItemId === itemId && isEffectiveAsOf(l, asOfDay));
    for (const line of children) {
      if (visited.has(line.childItemId)) continue; // 循環参照防御（第三防御）
      const childItem = items.find((i) => i.itemId === line.childItemId);
      const childQty = cumulativeQty * line.qtyPer;
      if (childItem?.makeBuy === 'BUY') {
        totals.set(line.childItemId, (totals.get(line.childItemId) ?? 0) + childQty);
      }
      const nextVisited = new Set(visited);
      nextVisited.add(line.childItemId);
      walk(line.childItemId, childQty, depth + 1, nextVisited);
    }
  }

  walk(topItemId, 1, 1, new Set([topItemId]));

  return [...totals.entries()].map(([itemId, totalQtyPer]) => {
    const item = items.find((i) => i.itemId === itemId);
    const purchasePrice = item?.purchasePrice ?? 0;
    return {
      itemId,
      name: item?.name ?? itemId,
      totalQtyPer,
      defaultSupplierId: item?.defaultSupplierId,
      purchasePrice: item?.purchasePrice,
      leadTimeDays: item?.leadTimeDays ?? 0,
      extendedCost: purchasePrice * totalQtyPer,
      supplierMissing: !item?.defaultSupplierId,
    };
  });
}

export function summarizePurchaseBomBySupplier(
  lines: PurchaseBomLine[],
): { supplierId: string; totalQty: number; totalCost: number }[] {
  const groups = new Map<string, { totalQty: number; totalCost: number }>();
  for (const line of lines) {
    const key = line.defaultSupplierId ?? '（未設定）';
    const g = groups.get(key) ?? { totalQty: 0, totalCost: 0 };
    g.totalQty += line.totalQtyPer;
    g.totalCost += line.extendedCost;
    groups.set(key, g);
  }
  return [...groups.entries()].map(([supplierId, v]) => ({ supplierId, ...v }));
}

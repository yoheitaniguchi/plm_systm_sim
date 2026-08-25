// 影響分析（Impact）ドメイン：BOM逆展開、変更影響トレーサビリティ、原価影響（3章#7、7.1、7.7）。
import { MAX_BOM_DEPTH } from './types';
import type { BomType, EngineeringChange, PlmBomLine, PlmItem } from './types';

export { MAX_BOM_DEPTH };

export function isEffectiveAsOf(line: PlmBomLine, day: number): boolean {
  const afterStart = line.effectiveFromDay <= day;
  const beforeEnd = line.effectiveToDay === undefined || day < line.effectiveToDay;
  return afterStart && beforeEnd;
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

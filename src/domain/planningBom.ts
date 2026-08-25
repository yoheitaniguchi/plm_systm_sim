// 計画BOM（Planning BOM）ドメイン：確定済みM-BOMを対象に、リードタイムを考慮した
// 時系列の所要展開（needByDay/startByDay）を算出する（新規スコープ、docs/design.md PLM-EXT-13、Issue #9）。
// 単一品目・単一数量・単一目標日のWhat-if展開に限定し、production_system_sim側の
// 計画オーダ（トランザクション）連携は対象外とする。
import { assertMbomConverted, isEffectiveAsOf, MAX_BOM_DEPTH } from './impactAnalysis';
import { resolveAlternates } from './mbom';
import type { PlmBomLine, PlmItem } from './types';

export interface PlanningExplosionLine {
  itemId: string;
  parentItemId: string; // トップレベル品目自身の行は空文字列
  level: number; // トップレベル品目が0
  qtyRequired: number;
  leadTimeDays: number;
  needByDay: number; // この行の部材が揃っているべき日
  startByDay: number; // 着手／発注すべき日（needByDay - leadTimeDays）
}

export function explodePlanningBom(
  topItemId: string,
  qty: number,
  targetNeedDay: number,
  asOfDay: number,
  bomLines: PlmBomLine[],
  items: PlmItem[],
  alternateOverrides: Record<string, string> = {},
): PlanningExplosionLine[] {
  assertMbomConverted(topItemId, bomLines);

  // currentMbomLines()は「旧版化されていない（effectiveToDay未設定）」行だけに絞り込むため、
  // asOfDayが過去日の場合に旧版行を誤って除外してしまう。ここではbomType==='M'の全行から
  // isEffectiveAsOf()でasOfDay時点の有効行のみを直接抽出する。
  const mLines = bomLines.filter((l) => l.bomType === 'M' && isEffectiveAsOf(l, asOfDay));
  const resolved = resolveAlternates(mLines, alternateOverrides);

  const results: PlanningExplosionLine[] = [];

  function walk(itemId: string, cumulativeQty: number, level: number, parentStartByDay: number, visited: Set<string>) {
    if (level > MAX_BOM_DEPTH) {
      throw new Error(`BOM階層が深さ上限(${MAX_BOM_DEPTH})を超えました。循環参照の疑いがあります`);
    }
    const children = resolved.filter((l) => l.parentItemId === itemId);
    for (const line of children) {
      if (visited.has(line.childItemId)) continue; // 循環参照防御（第三防御）
      const childItem = items.find((i) => i.itemId === line.childItemId);
      const leadTimeDays = childItem?.leadTimeDays ?? 0;
      const childQty = cumulativeQty * line.qtyPer;
      const needByDay = parentStartByDay;
      const startByDay = needByDay - leadTimeDays;
      results.push({
        itemId: line.childItemId,
        parentItemId: itemId,
        level,
        qtyRequired: childQty,
        leadTimeDays,
        needByDay,
        startByDay,
      });
      const nextVisited = new Set(visited);
      nextVisited.add(line.childItemId);
      walk(line.childItemId, childQty, level + 1, startByDay, nextVisited);
    }
  }

  const topItem = items.find((i) => i.itemId === topItemId);
  const topLeadTimeDays = topItem?.leadTimeDays ?? 0;
  const topStartByDay = targetNeedDay - topLeadTimeDays;
  results.push({
    itemId: topItemId,
    parentItemId: '',
    level: 0,
    qtyRequired: qty,
    leadTimeDays: topLeadTimeDays,
    needByDay: targetNeedDay,
    startByDay: topStartByDay,
  });
  walk(topItemId, qty, 1, topStartByDay, new Set([topItemId]));

  return results;
}

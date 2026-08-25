// M-BOMドメイン：製造部品表、E→M変換、代替部品（承認部品リスト）（3章#3、4.5、7.2、7.6）。
import { findRealParent, isEbomOnlyGroup } from './ebom';
import type { PlmBomLine } from './types';

// isEbomOnlyの行は変換時に「消滅」し、その子品目が親の親に直接ぶら下がる形に
// フラット化される（4.1「脚部ユニット」の例に対応）。
// 【前提】この関数への入力は、resolveConfiguration()で解決済み（optionGroupIdを
// 持つ行が残っていない）であることを要求する。未解決のままでは呼び出し不可（UC-VARIANT-3）。
export function convertEbomToMbom(
  ebomLines: PlmBomLine[],
  routingMap: Record<string, string>, // itemId → 対応する工程コード
  effectiveFromDay: number,
): PlmBomLine[] {
  if (ebomLines.some((l) => l.optionGroupId)) {
    throw new Error(
      '未解決のオプショングループが残っています。先にresolveConfiguration()で構成を確定してください',
    );
  }
  const result: PlmBomLine[] = [];

  for (const line of ebomLines) {
    // このBOM行の親がE-BOM限定グループなら、実際の親はさらにその親に付け替える
    const effectiveParentId = isEbomOnlyGroup(line.parentItemId, ebomLines)
      ? findRealParent(line.parentItemId, ebomLines)
      : line.parentItemId;

    if (isEbomOnlyGroup(line.childItemId, ebomLines)) continue; // グループ自体はM-BOMに出さない

    result.push({
      ...line,
      bomLineId: `M-${line.bomLineId}`,
      bomType: 'M',
      parentItemId: effectiveParentId,
      processStep: routingMap[line.childItemId],
      isEbomOnly: false,
      effectiveFromDay,
    });
  }
  return result;
}

// 4.5・7.6：代替部品グループの解決。4.4の resolveConfiguration と同じ
// 「複数の選択肢から1つを選ぶ」パターンだが、既定選択（優先順位最上位の承認済み品目）が
// 自動的に選ばれる点が異なる（オプショングループには既定の選択という概念が無い）。
export function resolveAlternates(
  mbomLines: PlmBomLine[],
  overrides: Record<string, string> = {}, // alternateGroupId -> 明示的に選んだchildItemId（任意）
): PlmBomLine[] {
  const groups = new Map<string, PlmBomLine[]>();
  for (const line of mbomLines) {
    if (!line.alternateGroupId) continue;
    if (line.approvalStatus !== '承認済') continue; // 未承認は選択肢に入れない（UC-ALT-3）
    const list = groups.get(line.alternateGroupId) ?? [];
    list.push(line);
    groups.set(line.alternateGroupId, list);
  }

  // 運用ルール（4.5）：承認済の品目のみ選択できる。未承認品目への明示的な切替は拒否する（UC-ALT-3）。
  for (const [groupId, chosenChildId] of Object.entries(overrides)) {
    const isApprovedChoice = (groups.get(groupId) ?? []).some((l) => l.childItemId === chosenChildId);
    if (!isApprovedChoice) {
      throw new Error(
        `代替部品グループ ${groupId} で選択された ${chosenChildId} は承認済ではないため選択できません`,
      );
    }
  }

  return mbomLines.filter((line) => {
    if (!line.alternateGroupId) return true; // 通常行はそのまま
    const groupId = line.alternateGroupId;
    const chosenChildId =
      overrides[groupId] ??
      groups
        .get(groupId)
        ?.sort((a, b) => (a.alternatePriority ?? 99) - (b.alternatePriority ?? 99))[0]?.childItemId;
    return line.childItemId === chosenChildId;
  });
}

// 現在有効なM-BOM行（旧版化されていないもの）だけを対象にBOMツリーを構築する際に使う。
export function currentMbomLines(bomLines: PlmBomLine[]): PlmBomLine[] {
  return bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay === undefined);
}

// UC-MBOM-3: E-BOM側が改訂され、まだM-BOM変換が実行されていない行を検出する。
// convertEbomToMbomはM-BOM行のbomLineIdを`M-${元のE-BOM行のbomLineId}`とするため、
// 現在有効なE-BOM行のうち対応するM-BOM行が存在しないものを「未反映」とみなす。
export function checkMbomStaleness(ebomLines: PlmBomLine[], mbomLines: PlmBomLine[]): string[] {
  const currentE = ebomLines.filter(
    (l) => l.bomType === 'E' && l.effectiveToDay === undefined && !l.optionGroupId,
  );
  const mbomSourceIds = new Set(
    mbomLines.filter((l) => l.bomType === 'M').map((l) => l.bomLineId.replace(/^M-/, '')),
  );
  const warnings: string[] = [];
  for (const line of currentE) {
    if (isEbomOnlyGroup(line.childItemId, ebomLines)) continue; // グループ自体は対象外
    if (!mbomSourceIds.has(line.bomLineId)) {
      warnings.push(`E-BOM行 ${line.bomLineId}（${line.parentItemId} → ${line.childItemId}）がM-BOMへ未反映です`);
    }
  }
  return warnings;
}

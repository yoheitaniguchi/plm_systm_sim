// M-BOMドメイン：製造部品表、E→M変換、代替部品（承認部品リスト）（3章#3、4.5、7.2、7.6）。
import { findRealParent, isEbomOnlyGroup } from './ebom';
import type { Operation, PlmBomLine } from './types';

// isEbomOnlyの行は変換時に「消滅」し、その子品目が親の親に直接ぶら下がる形に
// フラット化される（4.1「脚部ユニット」の例に対応）。
// 【前提】この関数への入力は、resolveConfiguration()で解決済み（optionGroupIdを
// 持つ行が残っていない）であることを要求する。未解決のままでは呼び出し不可（UC-VARIANT-3）。
export function convertEbomToMbom(
  ebomLines: PlmBomLine[],
  // 親品目のitemId → 既定の投入工程（親品目の工程コード）。親に工程が無ければ投入工程は未割当になる（PLM-EXT-18）
  defaultInputOperation: Record<string, string>,
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
      processStep: defaultInputOperation[effectiveParentId],
      isEbomOnly: false,
      effectiveFromDay,
    });
  }
  return result;
}

// 変換結果を既存のM-BOMへ取り込む（design.md PLM-EXT-16）。
// 再変換のたびに行を足すだけだと、同じ構成のM-BOM行が重複する。同じ変換範囲（`isInScope`が真の行）について、
// ①変換結果に無くなった現行行は`effectiveToDay`を設定して旧版化し（履歴は消さない）、
// ②変換結果と同じ`bomLineId`の現行行があればそのまま残し（割り当て済みの投入工程`processStep`は上書きしない。
//   未割当の行にだけ既定値を入れる。PLM-EXT-18）、
// ③それ以外の変換結果を新しい行として追加する。
// 変換範囲は「バリアント構成なしの変換」と「確定品目ごとの変換」で分かれ、行の`mbomScope`に記録する
// （`converted`の各行には呼び出し側が`scope`と同じ値を設定済みであること）。
// ある範囲の再変換が別の範囲の行を旧版化することはない。
export function mergeConvertedMbom(
  bomLines: PlmBomLine[],
  converted: PlmBomLine[],
  scope: string | undefined,
  effectiveFromDay: number,
): { added: number; closed: number; kept: number } {
  const convertedIds = new Set(converted.map((l) => l.bomLineId));
  if (convertedIds.size !== converted.length) {
    const seen = new Set<string>();
    const dup = converted.find((l) => (seen.has(l.bomLineId) ? true : (seen.add(l.bomLineId), false)));
    throw new Error(`変換元のE-BOM行IDが重複しているため変換できません（${dup?.bomLineId}）`);
  }
  const currentInScope = currentMbomLines(bomLines).filter((l) => l.mbomScope === scope);

  const toClose = currentInScope.filter((l) => !convertedIds.has(l.bomLineId));
  const tooEarly = toClose.find((l) => effectiveFromDay < l.effectiveFromDay);
  if (tooEarly) {
    throw new Error(
      `再変換の有効開始日（${effectiveFromDay}日目）が、旧版化するM-BOM行 ${tooEarly.bomLineId} の有効開始日（${tooEarly.effectiveFromDay}日目）より前です`,
    );
  }
  for (const line of toClose) line.effectiveToDay = effectiveFromDay;
  // E-BOM行を改訂すると行IDが変わり、M-BOM側は「旧行を旧版化＋新行を追加」になる。
  // このとき人が割り当てた投入工程が既定値に戻らないよう、同じ親子の旧行から引き継ぐ（PLM-EXT-18）
  const closedByPair = new Map(toClose.map((l) => [`${l.parentItemId}::${l.childItemId}`, l]));

  const currentById = new Map(currentInScope.map((l) => [l.bomLineId, l]));
  let added = 0;
  let kept = 0;
  for (const line of converted) {
    const existing = currentById.get(line.bomLineId);
    if (existing) {
      if (existing.processStep === undefined) existing.processStep = line.processStep;
      kept += 1;
    } else {
      const predecessor = closedByPair.get(`${line.parentItemId}::${line.childItemId}`);
      if (predecessor?.processStep !== undefined) line.processStep = predecessor.processStep;
      bomLines.push(line);
      added += 1;
    }
  }
  return { added, closed: toClose.length, kept };
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

// ---------- 投入工程（PLM-EXT-18） ----------

function currentOperationCodes(operations: Operation[], itemId: string): Set<string> {
  return new Set(operations.filter((o) => o.itemId === itemId && o.effectiveToDay === undefined).map((o) => o.opCode));
}

// 現在有効なM-BOM行に投入工程を割り当てる（opCodeがundefinedなら未割当に戻す）。
// 版は上げず、行をその場で書き換える（投入工程はMasterSnapshotに出ないPLM内の付加情報で、
// M-BOM行のIDは変換元のE-BOM行から決まるため、版を上げるとE-BOMとの対応が崩れる）。
// 同じbomLineIdが旧版と現行の両方にありうる（PLM-EXT-16の境界事例）ので、現行行だけを対象にする。
export function assignInputOperation(
  bomLines: PlmBomLine[],
  operations: Operation[],
  bomLineId: string,
  opCode: string | undefined,
): PlmBomLine {
  const line = currentMbomLines(bomLines).find((l) => l.bomLineId === bomLineId);
  if (!line) throw new Error(`現在有効なM-BOM行 ${bomLineId} が見つかりません`);
  if (opCode !== undefined && !currentOperationCodes(operations, line.parentItemId).has(opCode)) {
    throw new Error(`工程 ${opCode} は、親品目 ${line.parentItemId} の現在有効な工程にありません`);
  }
  line.processStep = opCode;
  return line;
}

export interface InputOperationIssue {
  bomLineId: string;
  parentItemId: string;
  childItemId: string;
  kind: '未割当' | '無効'; // 無効＝指している工程が終了している、または親品目の工程でない
  processStep?: string;
}

// 投入工程が未割当、または親品目の現在有効な工程を指していないM-BOM行を列挙する。
// 警告として見せるためのもので、変換・書き出しは止めない。
export function checkInputOperations(mbomLines: PlmBomLine[], operations: Operation[]): InputOperationIssue[] {
  const issues: InputOperationIssue[] = [];
  for (const line of mbomLines) {
    if (line.bomType !== 'M' || line.effectiveToDay !== undefined) continue;
    const base = { bomLineId: line.bomLineId, parentItemId: line.parentItemId, childItemId: line.childItemId };
    if (line.processStep === undefined) {
      issues.push({ ...base, kind: '未割当' });
    } else if (!currentOperationCodes(operations, line.parentItemId).has(line.processStep)) {
      issues.push({ ...base, kind: '無効', processStep: line.processStep });
    }
  }
  return issues;
}

// ある工程を投入工程として指している、現在有効なM-BOM行（工程の終了を止める判定に使う）。
export function linesUsingOperation(bomLines: PlmBomLine[], itemId: string, opCode: string): PlmBomLine[] {
  return currentMbomLines(bomLines).filter((l) => l.parentItemId === itemId && l.processStep === opCode);
}

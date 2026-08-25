// E-BOMドメイン：設計部品表、版数、バリアント（オプショングループ）（3章#2、4.4、7.2）。
import type { BomType, Configuration, PlmBomLine } from './types';

// 三重防御の第一防御：登録時にDFSで循環参照を拒否する（5章・UC-EBOM-3）。
// parentItemId -> childItemId という辺を追加した際に、既存の構造と合わせて
// 循環（childItemId から辿って parentItemId に戻ってこられる状態）になるかを判定する。
export function wouldCreateCycle(
  bomLines: PlmBomLine[],
  bomType: BomType,
  parentItemId: string,
  childItemId: string,
): boolean {
  if (parentItemId === childItemId) return true;
  const visited = new Set<string>();

  function dfs(current: string): boolean {
    if (current === parentItemId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const children = bomLines.filter(
      (l) => l.parentItemId === current && l.bomType === bomType && l.effectiveToDay === undefined,
    );
    return children.some((l) => dfs(l.childItemId));
  }

  return dfs(childItemId);
}

export interface NewEbomLineInput {
  bomLineId: string;
  parentItemId: string;
  childItemId: string;
  qtyPer: number;
  effectiveFromDay: number;
  processStep?: string;
  isEbomOnly?: boolean;
  optionGroupId?: string;
  optionCode?: string;
}

// UC-EBOM-1: 新規E-BOM行は版数1で作成される。
export function addEbomLine(bomLines: PlmBomLine[], input: NewEbomLineInput): PlmBomLine {
  if (wouldCreateCycle(bomLines, 'E', input.parentItemId, input.childItemId)) {
    throw new Error(
      `${input.parentItemId} → ${input.childItemId} を追加すると循環参照になるため登録できません`,
    );
  }
  const line: PlmBomLine = {
    parentItemId: input.parentItemId,
    childItemId: input.childItemId,
    qtyPer: input.qtyPer,
    bomLineId: input.bomLineId,
    bomType: 'E',
    version: 1,
    effectiveFromDay: input.effectiveFromDay,
    processStep: input.processStep,
    isEbomOnly: input.isEbomOnly,
    optionGroupId: input.optionGroupId,
    optionCode: input.optionCode,
  };
  bomLines.push(line);
  return line;
}

// UC-EBOM-2: ECOによりBOM行が更新される場合、旧版はeffectiveToDayを設定して残し、
// 新しい版数を発番した行を追加する（履歴を消さない、6章・EXT-24と同じ思想）。
export function reviseEbomLine(
  bomLines: PlmBomLine[],
  bomLineId: string,
  patch: Partial<Pick<PlmBomLine, 'qtyPer' | 'processStep' | 'optionGroupId' | 'optionCode'>>,
  newBomLineId: string,
  effectiveFromDay: number,
): PlmBomLine {
  const oldLine = bomLines.find((l) => l.bomLineId === bomLineId);
  if (!oldLine) throw new Error(`E-BOM行 ${bomLineId} が見つかりません`);
  if (oldLine.effectiveToDay !== undefined) {
    throw new Error(`E-BOM行 ${bomLineId} は既に旧版化されています`);
  }
  if (effectiveFromDay <= oldLine.effectiveFromDay) {
    throw new Error('新しい版の有効開始日は旧版より後である必要があります');
  }

  oldLine.effectiveToDay = effectiveFromDay;

  const newLine: PlmBomLine = {
    ...oldLine,
    ...patch,
    bomLineId: newBomLineId,
    version: oldLine.version + 1,
    effectiveFromDay,
    effectiveToDay: undefined,
  };
  bomLines.push(newLine);
  return newLine;
}

// 150%BOM（未解決のオプショングループを含むE-BOM）から、1つの構成を選んで
// 具体的なBOM行の集合に確定させる。未選択のオプションは除外される（7.2）。
export function resolveConfiguration(
  ebomLines: PlmBomLine[],
  configuration: Configuration,
): PlmBomLine[] {
  return ebomLines
    .filter((line) => {
      if (!line.optionGroupId) return true; // 固定行はそのまま採用
      return line.optionCode === configuration.selections[line.optionGroupId];
    })
    .map((line) => ({
      ...line,
      parentItemId:
        line.parentItemId === configuration.baseItemId
          ? configuration.resolvedItemId // トップレベル品目を確定後の品目コードへ差し替え
          : line.parentItemId,
      // 採用されたオプション行は、この時点で「確定した通常のBOM行」になる。
      // optionGroupId/optionCodeを残したままだと、convertEbomToMbom（7.2）の
      // 「未解決のオプショングループが残っていないこと」という前提を満たせない。
      optionGroupId: undefined,
      optionCode: undefined,
    }));
}

export function isEbomOnlyGroup(itemId: string, lines: PlmBomLine[]): boolean {
  return lines.some((l) => l.parentItemId === itemId && l.isEbomOnly);
}

export function findRealParent(groupItemId: string, lines: PlmBomLine[]): string {
  const line = lines.find((l) => l.childItemId === groupItemId);
  if (!line) throw new Error(`グループ ${groupItemId} の親が見つかりません`);
  return line.parentItemId;
}

// 現在有効なE-BOM行（旧版化されていないもの）だけを対象にBOMツリーを構築する際に使う。
export function currentEbomLines(bomLines: PlmBomLine[]): PlmBomLine[] {
  return bomLines.filter((l) => l.bomType === 'E' && l.effectiveToDay === undefined);
}

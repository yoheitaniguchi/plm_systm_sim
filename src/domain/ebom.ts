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
  changeId?: string; // 由来の変更（任意。PLM-EXT-21）
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
  if (input.changeId !== undefined) line.changeId = input.changeId;
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
  changeId?: string, // 由来の変更（任意。PLM-EXT-21）
): PlmBomLine {
  const oldLine = bomLines.find((l) => l.bomLineId === bomLineId);
  if (!oldLine) throw new Error(`E-BOM行 ${bomLineId} が見つかりません`);
  if (oldLine.bomType !== 'E') throw new Error(`${bomLineId} はE-BOM行ではありません`);
  if (oldLine.effectiveToDay !== undefined) {
    throw new Error(`E-BOM行 ${bomLineId} は既に旧版化されています`);
  }
  if (!Number.isInteger(effectiveFromDay) || effectiveFromDay < 0) {
    throw new Error('有効開始日は0以上の整数（日数）である必要があります');
  }
  if (effectiveFromDay <= oldLine.effectiveFromDay) {
    throw new Error('新しい版の有効開始日は旧版より後である必要があります');
  }

  // 何も変わらない改訂は受け付けない（版とリビジョンだけが上がり、その日は元に戻せなくなるため。PLM-EXT-23）
  // undefined の項目は「指定なし」として扱う（判定と適用を揃える）
  const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as typeof patch;
  const changed = (Object.keys(given) as (keyof typeof given)[]).some((k) => given[k] !== oldLine[k]);
  if (!changed) throw new Error('今の内容と同じです。変更する値を入力してください');

  oldLine.effectiveToDay = effectiveFromDay;

  const newLine: PlmBomLine = {
    ...oldLine,
    ...given,
    bomLineId: newBomLineId,
    version: oldLine.version + 1,
    effectiveFromDay,
    effectiveToDay: undefined,
  };
  // 由来の変更は版ごとに記録する（旧版の由来を新しい版へ持ち越さない）
  delete newLine.changeId;
  delete newLine.endChangeId;
  if (changeId !== undefined) {
    newLine.changeId = changeId;
    oldLine.endChangeId = changeId;
  }
  bomLines.push(newLine);
  return newLine;
}

// 日付の意味（PLM-EXT-21）：終了・置換に渡す日は「変更が効く日」。改訂（reviseEbomLine）と同じで、
// 行はその前日まで有効、その日から無効になる（effectiveToDayにはこの日を入れる。isEffectiveAsOf()は
// day < effectiveToDay で判定する）。行が1日も有効にならない終了はできないので、行の開始日より後の日だけを受け付ける。
function assertChangeDay(line: PlmBomLine, day: number): void {
  if (!Number.isInteger(day) || day < 0) {
    throw new Error('変更が効く日は0以上の整数（日数）である必要があります');
  }
  if (line.bomType !== 'E') throw new Error(`${line.bomLineId} はE-BOM行ではありません`);
  if (line.effectiveToDay !== undefined) {
    throw new Error(`E-BOM行 ${line.bomLineId} は既に旧版化されています`);
  }
  if (day <= line.effectiveFromDay) {
    throw new Error('変更が効く日は、行の有効開始日より後である必要があります');
  }
}

// 画面用：現行のE-BOM行について、いま改訂・終了・置換ができない理由を返す（できるならundefined）。
// 判定は終了・置換の本体と同じ条件で、画面はボタンを無効にして理由を見せるためだけに使う（PLM-EXT-23）。
export interface EbomLineBlockers {
  day?: string; // その日は改訂・終了・置換のどれもできない
  end?: string;
  replace?: string;
}

export function ebomLineBlockers(bomLines: PlmBomLine[], line: PlmBomLine, day: number): EbomLineBlockers {
  const blockers: EbomLineBlockers = {};
  const current = currentEbomLines(bomLines);
  if (day < line.effectiveFromDay) blockers.day = `D${line.effectiveFromDay}から有効になる予定の行のため、D${line.effectiveFromDay + 1}以降に変更できます`;
  else if (day === line.effectiveFromDay) blockers.day = `D${line.effectiveFromDay}に始まった行のため、D${line.effectiveFromDay + 1}以降に変更できます`;
  if (isEbomOnlyGroup(line.childItemId, current)) {
    blockers.end = 'E-BOM限定グループへの行';
    blockers.replace = 'E-BOM限定グループへの行';
  } else if (wouldEmptyGroup(bomLines, line, day)) {
    blockers.end = 'グループで今有効な最後の子';
  }
  if (line.alternateGroupId !== undefined) blockers.replace = '代替部品グループの行';
  return blockers;
}

// E-BOM限定グループの子行を、その日から終了するとグループが空になるか（PLM-EXT-21、X3 事後判断）。
// 「変更が効く日」に、終了する行を除いてそのグループに効いている子が1つも無ければ空になる。
// 現行行（effectiveToDay が無い行）で数えると、未来に始まる子があるだけで今効いている最後の子を終了でき、
// その子が始まるまでグループの子が0になる抜け道になるため、その日に効いているかで数える
// （判定は impactAnalysis.isEffectiveAsOf() と同じ。ebom から impactAnalysis へは依存させないため写している）。
function wouldEmptyGroup(bomLines: PlmBomLine[], line: PlmBomLine, day: number): boolean {
  if (!line.isEbomOnly) return false;
  return !bomLines.some(
    (l) =>
      l.bomLineId !== line.bomLineId &&
      l.bomType === 'E' &&
      l.parentItemId === line.parentItemId &&
      l.isEbomOnly &&
      l.effectiveFromDay <= day &&
      (l.effectiveToDay === undefined || day < l.effectiveToDay),
  );
}

// 「親 → E-BOM限定グループ」の行は終了・置換できない（PLM-EXT-21）。グループの子行が残ったまま親への
// つながりが無くなると、M-BOMへの変換がグループの実親を見つけられなくなるため。
function assertNotLineToGroup(line: PlmBomLine, bomLines: PlmBomLine[]): void {
  if (isEbomOnlyGroup(line.childItemId, currentEbomLines(bomLines))) {
    throw new Error(
      `E-BOM行 ${line.bomLineId} はE-BOM限定グループ ${line.childItemId} への行のため、終了・置換できません`,
    );
  }
}

// E-BOM限定グループを畳んだ後の親（グループの下の行なら、グループの実親）。循環に備えて段数を限る。
// 置換の重複検査と、画面の置換候補の絞り込み（EbomChangePanel）で共有する
export function flattenedParent(parentItemId: string, currentLines: PlmBomLine[]): string {
  let parent = parentItemId;
  for (let depth = 0; depth < 20 && isEbomOnlyGroup(parent, currentLines); depth++) {
    const toGroup = currentLines.find((l) => l.childItemId === parent);
    if (!toGroup) break;
    parent = toGroup.parentItemId;
  }
  return parent;
}

// 子品目の置換で、同じ親子の行が重なるか（PLM-EXT-21）。E-BOM限定グループの下の行は、M-BOMへ変換すると
// グループの実親の行になる。変換後に同じ親子の行が2つできないよう、グループを畳んだ後の親で比べる。
// 置換の拒否と、画面の置換候補の絞り込み（EbomChangePanel）で同じ判定を使う
export function wouldDuplicateOnReplace(currentLines: PlmBomLine[], oldLine: PlmBomLine, newChildItemId: string): boolean {
  const flatParent = flattenedParent(oldLine.parentItemId, currentLines);
  return currentLines.some(
    (l) =>
      l.bomLineId !== oldLine.bomLineId &&
      l.childItemId === newChildItemId &&
      l.optionGroupId === oldLine.optionGroupId &&
      l.optionCode === oldLine.optionCode &&
      flattenedParent(l.parentItemId, currentLines) === flatParent,
  );
}

// E-BOM行の終了（PLM-EXT-21）。後継の行を作らずに閉じる。行は削除せず履歴に残す。
export function endEbomLine(
  bomLines: PlmBomLine[],
  bomLineId: string,
  effectiveFromDay: number, // 変更が効く日（この日から行が無効になる）
  changeId?: string,
): PlmBomLine {
  const line = bomLines.find((l) => l.bomLineId === bomLineId);
  if (!line) throw new Error(`E-BOM行 ${bomLineId} が見つかりません`);
  assertChangeDay(line, effectiveFromDay);
  assertNotLineToGroup(line, bomLines);
  if (wouldEmptyGroup(bomLines, line, effectiveFromDay)) {
    throw new Error(
      `E-BOM限定グループ ${line.parentItemId} は、D${effectiveFromDay}に有効な子がこの行のほかに無いため終了できません（グループを空にする操作には対応していません）`,
    );
  }
  line.effectiveToDay = effectiveFromDay;
  if (changeId !== undefined) line.endChangeId = changeId;
  return line;
}

// 子品目の置換（PLM-EXT-21）。旧行を終了し、同じ親・同じ員数・同じ属性で子品目だけが違う行を足す。
// 新しい行は別の子品目の行なので、版の続きにせず版数1から始める。
export function replaceEbomChild(
  bomLines: PlmBomLine[],
  bomLineId: string,
  newChildItemId: string,
  newBomLineId: string,
  effectiveFromDay: number, // 変更が効く日（この日から旧行が無効、新しい行が有効）
  changeId?: string,
): PlmBomLine {
  const oldLine = bomLines.find((l) => l.bomLineId === bomLineId);
  if (!oldLine) throw new Error(`E-BOM行 ${bomLineId} が見つかりません`);
  assertChangeDay(oldLine, effectiveFromDay);
  assertNotLineToGroup(oldLine, bomLines);
  if (oldLine.alternateGroupId !== undefined) {
    throw new Error(
      `E-BOM行 ${bomLineId} は代替部品グループ ${oldLine.alternateGroupId} の行のため置換できません（置換すると、未評価の品目が承認済みの代替部品になってしまいます）`,
    );
  }
  if (newChildItemId === oldLine.childItemId) {
    throw new Error('置換後の子品目が今と同じです');
  }
  if (wouldDuplicateOnReplace(currentEbomLines(bomLines), oldLine, newChildItemId)) {
    throw new Error(`${oldLine.parentItemId} は既に ${newChildItemId} を子に持っています（員数を変えるには、その行を改訂してください）`);
  }
  // 旧行を除いた状態で循環を調べる（旧行はこの操作で無効になる）
  const others = bomLines.filter((l) => l !== oldLine);
  if (wouldCreateCycle(others, 'E', oldLine.parentItemId, newChildItemId)) {
    throw new Error(`${oldLine.parentItemId} → ${newChildItemId} を追加すると循環参照になるため置換できません`);
  }

  oldLine.effectiveToDay = effectiveFromDay;
  const newLine: PlmBomLine = {
    ...oldLine,
    childItemId: newChildItemId,
    bomLineId: newBomLineId,
    version: 1,
    effectiveFromDay,
    effectiveToDay: undefined,
  };
  delete newLine.changeId;
  delete newLine.endChangeId;
  if (changeId !== undefined) {
    newLine.changeId = changeId;
    oldLine.endChangeId = changeId;
  }
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

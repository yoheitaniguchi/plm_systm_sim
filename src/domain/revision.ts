// 品目リビジョンの導出と差分（design.md PLM-EXT-22）。
// リビジョンはデータとして持たず、E-BOM行の「版数＋有効日」から導出する（所有者決定の「案2＋」）。
// 品目Xのリビジョン＝「Xを親とするE-BOM行の集合が変わった日」で区切った期間。親の親は改版しない。
// ここにあるのは状態を変えない導出関数だけ。
import { isEffectiveAsOf } from './impactAnalysis';
import type { PlmBomLine } from './types';

export type RevisionStatus = '予定' | '有効' | '旧版';

export interface DerivedRevision {
  itemId: string;
  rev: string; // A, B, C ... Z, AA, AB ...（区切りの順に採番）
  fromDay: number; // この構成が有効になった日
  toDay?: number; // 次の区切りの日（この日から次のリビジョン。最新は未設定）
  status: RevisionStatus;
  lines: PlmBomLine[]; // fromDay時点で有効な、itemIdを親とするE-BOM行（子を持たない期間は空）
  changeIds: string[]; // この区切りを作った行の由来の変更（PLM-EXT-21のchangeId・endChangeId）
}

export interface RevisionDiffLine {
  kind: '追加' | '削除' | '数量変更';
  childItemId: string;
  optionGroupId?: string;
  optionCode?: string;
  qtyBefore?: number;
  qtyAfter?: number;
}

// 0 → A, 25 → Z, 26 → AA
export function revisionLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function parentLines(itemId: string, bomLines: PlmBomLine[]): PlmBomLine[] {
  return bomLines.filter((l) => l.bomType === 'E' && l.parentItemId === itemId);
}

// 品目のリビジョンを古い順に返す。E-BOMで子を持ったことが無い品目は空配列。
// 区切りは、itemIdを親とする行の有効開始日と終了日（effectiveToDay＝その日から無効）。
// 同じ日の複数の変更は1つのリビジョンにまとまる。全行を終了した後の「子を持たない期間」も1つのリビジョンに数える。
export function deriveRevisions(itemId: string, bomLines: PlmBomLine[], currentDay: number): DerivedRevision[] {
  const lines = parentLines(itemId, bomLines);
  if (lines.length === 0) return [];
  const days = new Set<number>();
  for (const l of lines) {
    days.add(l.effectiveFromDay);
    if (l.effectiveToDay !== undefined) days.add(l.effectiveToDay);
  }
  const boundaries = [...days].sort((a, b) => a - b);

  return boundaries.map((fromDay, i) => {
    const toDay = boundaries[i + 1];
    const changeIds = new Set<string>();
    for (const l of lines) {
      if (l.effectiveFromDay === fromDay && l.changeId !== undefined) changeIds.add(l.changeId);
      if (l.effectiveToDay === fromDay && l.endChangeId !== undefined) changeIds.add(l.endChangeId);
    }
    let status: RevisionStatus = '有効';
    if (fromDay > currentDay) status = '予定';
    else if (toDay !== undefined && toDay <= currentDay) status = '旧版';
    const revision: DerivedRevision = {
      itemId,
      rev: revisionLabel(i),
      fromDay,
      status,
      lines: lines.filter((l) => isEffectiveAsOf(l, fromDay)),
      changeIds: [...changeIds].sort(),
    };
    if (toDay !== undefined) revision.toDay = toDay;
    return revision;
  });
}

// E-BOMで子を持ったことがある品目（リビジョンを導出できる品目）の一覧
export function itemsWithRevisions(bomLines: PlmBomLine[]): string[] {
  return [...new Set(bomLines.filter((l) => l.bomType === 'E').map((l) => l.parentItemId))].sort();
}

// 差分の突き合わせキー：子品目＋オプショングループ＋オプションコード（所有者決定）。
// オプションコードはグループの中で意味を持つ値なので、グループも含める
function diffKey(line: PlmBomLine): string {
  return JSON.stringify([line.childItemId, line.optionGroupId ?? null, line.optionCode ?? null]);
}

interface KeyedQty {
  childItemId: string;
  optionGroupId?: string;
  optionCode?: string;
  qty: number;
}

function keyedQuantities(lines: PlmBomLine[]): Map<string, KeyedQty> {
  const map = new Map<string, KeyedQty>();
  for (const l of lines) {
    const key = diffKey(l);
    const entry = map.get(key);
    // 同じキーの行が複数ある場合（同じ親子の行を重ねて登録した場合）は員数を合算する
    if (entry) entry.qty += l.qtyPer;
    else {
      const created: KeyedQty = { childItemId: l.childItemId, qty: l.qtyPer };
      if (l.optionGroupId !== undefined) created.optionGroupId = l.optionGroupId;
      if (l.optionCode !== undefined) created.optionCode = l.optionCode;
      map.set(key, created);
    }
  }
  return map;
}

// 2つのリビジョンの差分（追加／削除／数量変更）。子品目の置換は「削除＋追加」の2行になる。
// 員数以外（投入工程のコード等）だけが変わった行は差分に出ない。
export function diffRevisions(from: DerivedRevision, to: DerivedRevision): RevisionDiffLine[] {
  const before = keyedQuantities(from.lines);
  const after = keyedQuantities(to.lines);
  const result: RevisionDiffLine[] = [];
  const base = (e: KeyedQty) => {
    const line: Pick<RevisionDiffLine, 'childItemId' | 'optionGroupId' | 'optionCode'> = { childItemId: e.childItemId };
    if (e.optionGroupId !== undefined) line.optionGroupId = e.optionGroupId;
    if (e.optionCode !== undefined) line.optionCode = e.optionCode;
    return line;
  };
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) result.push({ kind: '削除', ...base(b), qtyBefore: b.qty });
    else if (a.qty !== b.qty) result.push({ kind: '数量変更', ...base(b), qtyBefore: b.qty, qtyAfter: a.qty });
  }
  for (const [key, a] of after) {
    if (!before.has(key)) result.push({ kind: '追加', ...base(a), qtyAfter: a.qty });
  }
  const order = { 削除: 0, 数量変更: 1, 追加: 2 } as const;
  return result.sort(
    (x, y) => order[x.kind] - order[y.kind] || x.childItemId.localeCompare(y.childItemId) || (x.optionCode ?? '').localeCompare(y.optionCode ?? ''),
  );
}

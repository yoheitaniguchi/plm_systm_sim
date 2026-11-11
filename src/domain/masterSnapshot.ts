// マスタ連携（Sync）ドメイン：MasterSnapshotの取り込み・書き出し、SSOT競合検知（3章#6、7.3、7.4、9章）。
import { checkOperations, operationsFromRoutingSteps, routingStepsFromOperations } from './operation';
import type {
  BomLine,
  ConflictDetail,
  EngineeringChange,
  ExportPreflightResult,
  ItemMaster,
  MasterSnapshot,
  Operation,
  Passthrough,
  PlmBomLine,
  PlmItem,
  RoutingStep,
  SyncSession,
} from './types';

// ---------- スキーマ検証（二層構造の第一層：最初のエラーで即時中断） ----------
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function assertItemMaster(raw: unknown, index: number): ItemMaster {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`items[${index}] が不正です`);
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) throw new Error(`items[${index}].itemId が不正です`);
  if (!isNonEmptyString(r.name)) throw new Error(`items[${index}].name が不正です`);
  if (r.makeBuy !== 'MAKE' && r.makeBuy !== 'BUY') {
    throw new Error(`items[${index}].makeBuy は "MAKE" または "BUY" である必要があります`);
  }
  if (typeof r.leadTimeDays !== 'number' || r.leadTimeDays < 0 || !Number.isInteger(r.leadTimeDays)) {
    throw new Error(`items[${index}].leadTimeDays は0以上の整数である必要があります`);
  }
  const item: ItemMaster = {
    itemId: r.itemId,
    name: r.name,
    makeBuy: r.makeBuy,
    leadTimeDays: r.leadTimeDays,
  };
  if (r.defaultSupplierId !== undefined) item.defaultSupplierId = String(r.defaultSupplierId);
  if (r.purchasePrice !== undefined) item.purchasePrice = Number(r.purchasePrice);
  if (r.salesPrice !== undefined) item.salesPrice = Number(r.salesPrice);
  return item;
}

function assertBomLine(raw: unknown, index: number): BomLine {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`bom[${index}] が不正です`);
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.parentItemId)) throw new Error(`bom[${index}].parentItemId が不正です`);
  if (!isNonEmptyString(r.childItemId)) throw new Error(`bom[${index}].childItemId が不正です`);
  if (typeof r.qtyPer !== 'number' || r.qtyPer <= 0) {
    throw new Error(`bom[${index}].qtyPer は正の数である必要があります`);
  }
  return { parentItemId: r.parentItemId, childItemId: r.childItemId, qtyPer: r.qtyPer };
}

// 工順の行。PLMが工程（Operation）として取り込むため、形を検査する（PLM-EXT-17）。
// 検査の基準はproduction_system_sim側のmasterIOに合わせる（stepNoは正の整数、時間は0以上）。
// 段取り時間（setupMin）は任意項目で、あれば落とさずに保持する。
function assertRoutingStep(raw: unknown, index: number): RoutingStep {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`routingSteps[${index}] が不正です`);
  }
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) throw new Error(`routingSteps[${index}].itemId が不正です`);
  if (typeof r.stepNo !== 'number' || !Number.isInteger(r.stepNo) || r.stepNo <= 0) {
    throw new Error(`routingSteps[${index}].stepNo は正の整数である必要があります`);
  }
  if (!isNonEmptyString(r.workCenter)) throw new Error(`routingSteps[${index}].workCenter が不正です`);
  if (typeof r.stdTimeMin !== 'number' || !Number.isFinite(r.stdTimeMin) || r.stdTimeMin < 0) {
    throw new Error(`routingSteps[${index}].stdTimeMin は0以上の数値である必要があります`);
  }
  const step: RoutingStep = {
    itemId: r.itemId,
    stepNo: r.stepNo,
    workCenter: r.workCenter,
    stdTimeMin: r.stdTimeMin,
  };
  // production_system_sim側と同じく、nullは未設定として扱う
  if (r.setupMin !== undefined && r.setupMin !== null) {
    if (typeof r.setupMin !== 'number' || !Number.isFinite(r.setupMin) || r.setupMin < 0) {
      throw new Error(`routingSteps[${index}].setupMin は0以上の数値である必要があります`);
    }
    step.setupMin = r.setupMin;
  }
  return step;
}

// MasterSnapshot JSON のスキーマ検証（フィールド単位、最初のエラーで即時中断）。
// 既知のフィールドだけを読み、それ以外のプロパティ（PLM独自の付加フィールド等）は無視する。
export function parseMasterSnapshot(json: unknown): MasterSnapshot {
  if (typeof json !== 'object' || json === null) {
    throw new Error('MasterSnapshotの形式が不正です');
  }
  const r = json as Record<string, unknown>;
  if (r.version !== 1) throw new Error('MasterSnapshot.version は 1 である必要があります');
  if (!Array.isArray(r.items)) throw new Error('MasterSnapshot.items は配列である必要があります');
  if (!Array.isArray(r.bom)) throw new Error('MasterSnapshot.bom は配列である必要があります（bomLinesではありません）');
  if (!Array.isArray(r.routingSteps)) throw new Error('MasterSnapshot.routingSteps は配列である必要があります');
  if (!Array.isArray(r.workCenters)) throw new Error('MasterSnapshot.workCenters は配列である必要があります');
  if (!Array.isArray(r.customers)) throw new Error('MasterSnapshot.customers は配列である必要があります');
  if (!Array.isArray(r.suppliers)) throw new Error('MasterSnapshot.suppliers は配列である必要があります');

  return {
    version: 1,
    items: r.items.map((i, idx) => assertItemMaster(i, idx)),
    bom: r.bom.map((l, idx) => assertBomLine(l, idx)),
    routingSteps: r.routingSteps.map((s, idx) => assertRoutingStep(s, idx)),
    workCenters: r.workCenters as MasterSnapshot['workCenters'],
    customers: r.customers as MasterSnapshot['customers'],
    suppliers: r.suppliers as MasterSnapshot['suppliers'],
  };
}

// 三重防御の第二防御：MasterSnapshotインポート時に、BOM全体をまとめて循環参照検査する
// （5章「BOMの循環参照防止は production_system_sim の『三重防御』パターンを踏襲する」）。
export function detectBomCycles(bom: BomLine[]): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const l of bom) {
    const list = childrenOf.get(l.parentItemId) ?? [];
    list.push(l.childItemId);
    childrenOf.set(l.parentItemId, list);
  }
  const problems: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (visiting.has(node)) {
      problems.push(`循環参照を検出しました: ${[...path, node].join(' → ')}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const child of childrenOf.get(node) ?? []) {
      dfs(child, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of childrenOf.keys()) {
    if (!visited.has(node)) dfs(node, []);
  }
  return problems;
}

// 業務整合性検証（二層構造の第二層：全項目をまとめてから一括拒否）。
// 主キー重複・BOM循環・参照整合性を検査する。
export function assertSnapshotUsable(snapshot: MasterSnapshot): void {
  const problems: string[] = [];

  const seenItemIds = new Set<string>();
  for (const item of snapshot.items) {
    if (seenItemIds.has(item.itemId)) {
      problems.push(`品目コード ${item.itemId} が重複しています`);
    }
    seenItemIds.add(item.itemId);
  }

  problems.push(...detectBomCycles(snapshot.bom));

  // 同じ品目の中で工順の順序（stepNo）が重複していると、工程コード（OP＋stepNo）が一意にならない
  const seenSteps = new Set<string>();
  for (const step of snapshot.routingSteps) {
    const key = `${step.itemId}:${step.stepNo}`;
    if (seenSteps.has(key)) problems.push(`品目 ${step.itemId} の工順 ${step.stepNo} が重複しています`);
    seenSteps.add(key);
  }

  const itemIds = new Set(snapshot.items.map((i) => i.itemId));
  for (const line of snapshot.bom) {
    if (!itemIds.has(line.parentItemId)) {
      problems.push(`BOM行が参照する親品目 ${line.parentItemId} が品目マスタに存在しません`);
    }
    if (!itemIds.has(line.childItemId)) {
      problems.push(`BOM行が参照する子品目 ${line.childItemId} が品目マスタに存在しません`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`MasterSnapshotの業務整合性検証でエラーが見つかりました:\n- ${problems.join('\n- ')}`);
  }
}

// production_system_simからエクスポートされたMasterSnapshotを、PLM独自属性を
// 付与してPLM内部形式に取り込む。routingStepsは工程（Operation）に変換して持つ（PLM-EXT-17）。
// workCenters/customers/suppliersはPLMドメイン外のためそのまま保持し、後で書き出す際に「パススルー」する。
// あわせてSyncSessionのベースラインを作成する（9.6のSSOT競合検知で使う）。
export function importMasterSnapshot(
  snapshot: MasterSnapshot,
  importedAtDay: number,
): {
  items: PlmItem[];
  bomLines: PlmBomLine[];
  operations: Operation[];
  passthrough: Passthrough;
  session: SyncSession;
} {
  const items: PlmItem[] = snapshot.items.map((i) => ({
    ...i,
    lifecycleStatus: '量産', // 既存品として取り込むため「量産」から開始
  }));
  const bomLines: PlmBomLine[] = snapshot.bom.map((l, idx) => ({
    ...l,
    bomLineId: `E-IMPORT-${idx}`,
    bomType: 'E',
    version: 1,
    effectiveFromDay: 0,
  }));
  return {
    items,
    bomLines,
    operations: operationsFromRoutingSteps(snapshot.routingSteps),
    passthrough: {
      workCenters: snapshot.workCenters,
      customers: snapshot.customers,
      suppliers: snapshot.suppliers,
    },
    session: {
      importedAtDay,
      baseline: snapshot,
      touchedItemIds: new Set(),
      touchedBomKeys: new Set(),
    },
  };
}

// JSON入力からの取り込み一式：スキーマ検証→業務整合性検証→importMasterSnapshot。
export function importMasterSnapshotFromJson(
  json: unknown,
  importedAtDay: number,
): ReturnType<typeof importMasterSnapshot> {
  const snapshot = parseMasterSnapshot(json);
  assertSnapshotUsable(snapshot);
  return importMasterSnapshot(snapshot, importedAtDay);
}

// エクスポート前の参照整合性チェック。production_system_sim側の
// assertSnapshotUsable()はitems/bomを含むsnapshot全体を検証するため、
// PLM側の変更（品目の即時廃却等）で工程が指すitemId/workCenterが宙に浮いたり、
// 同じ品目の中で順序（stepNo）が重複したりすると、production_system_sim側でインポート
// 全体が拒否される。それをPLM側で事前に検出し、ユーザーに提示する。
export function checkReferentialIntegrityBeforeExport(
  items: PlmItem[],
  _mbomLines: PlmBomLine[],
  passthrough: Passthrough,
  operations: Operation[],
): string[] {
  const problems: string[] = checkOperations(operations, items, passthrough.workCenters);
  for (const item of items) {
    if (item.makeBuy === 'BUY' && !item.defaultSupplierId) {
      problems.push(`購買品目 ${item.itemId} に既定仕入先が未設定です（production_system_sim側の業務検証でエラーになります）`);
    }
  }
  return problems;
}

// PLM独自属性を取り除き、production_system_sim互換のItemMaster/BomLineだけを取り出す。
export function stripPlmOnlyItemFields(item: PlmItem): ItemMaster {
  const core: ItemMaster = {
    itemId: item.itemId,
    name: item.name,
    makeBuy: item.makeBuy,
    leadTimeDays: item.leadTimeDays,
  };
  if (item.defaultSupplierId !== undefined) core.defaultSupplierId = item.defaultSupplierId;
  if (item.purchasePrice !== undefined) core.purchasePrice = item.purchasePrice;
  if (item.salesPrice !== undefined) core.salesPrice = item.salesPrice;
  return core;
}

export function stripPlmOnlyBomFields(line: PlmBomLine): BomLine {
  return { parentItemId: line.parentItemId, childItemId: line.childItemId, qtyPer: line.qtyPer };
}

// ECOクローズ後、更新済みのM-BOM・品目・工程を、取り込んだ際のpassthroughデータと
// マージして新しいMasterSnapshotを組み立てる。工順は現在有効な工程から作り（PLM-EXT-17）、
// 作業区・得意先・仕入先はPLMでは編集しないため、そのまま素通しする。
export function buildUpdatedMasterSnapshot(
  change: EngineeringChange,
  currentItems: PlmItem[],
  mbomLines: PlmBomLine[],
  passthrough: Passthrough,
  operations: Operation[],
): MasterSnapshot {
  if (change.status !== 'クローズ') {
    throw new Error('クローズ前のECOはエクスポート不可');
  }
  if (change.effectiveFromDay === undefined) {
    throw new Error('有効日未設定のECOはエクスポート不可');
  }
  const problems = checkReferentialIntegrityBeforeExport(currentItems, mbomLines, passthrough, operations);
  if (problems.length > 0) {
    throw new Error(`エクスポートできません:\n- ${problems.join('\n- ')}`);
  }

  return {
    version: 1,
    items: currentItems.map(stripPlmOnlyItemFields),
    bom: mbomLines.filter((l) => !l.isEbomOnly).map(stripPlmOnlyBomFields),
    ...passthrough,
    routingSteps: routingStepsFromOperations(operations),
  };
}

// ECOがクローズするたびに呼び、そのECOが触った品目・BOM行をSyncSessionへ
// 蓄積する（9.6のSSOT競合検知が「PLM側は何を変更したか」を知るために使う）。
export function recordTouchedByChange(
  session: SyncSession,
  change: EngineeringChange,
  mbomLines: PlmBomLine[],
): void {
  for (const id of change.impactedItemIds) session.touchedItemIds.add(id);
  for (const bomLineId of change.impactedBomLineIds) {
    const line = mbomLines.find((l) => l.bomLineId === bomLineId);
    if (line) session.touchedBomKeys.add(`${line.parentItemId}::${line.childItemId}`);
  }
}

// 変更検知用のスナップショットハッシュ（配列の並び順の違いだけで
// 誤って「変更あり」と判定しないよう、主キーでソートしてから計算する）。
export async function hashSnapshot(snapshot: MasterSnapshot): Promise<string> {
  const canonical = JSON.stringify({
    items: [...snapshot.items].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    bom: [...snapshot.bom].sort((a, b) =>
      `${a.parentItemId}::${a.childItemId}`.localeCompare(`${b.parentItemId}::${b.childItemId}`),
    ),
    routingSteps: [...snapshot.routingSteps].sort((a, b) =>
      `${a.itemId}:${a.stepNo}`.localeCompare(`${b.itemId}:${b.stepNo}`),
    ),
    workCenters: [...snapshot.workCenters].sort((a, b) => a.workCenter.localeCompare(b.workCenter)),
    customers: [...snapshot.customers].sort((a, b) => a.customerId.localeCompare(b.customerId)),
    suppliers: [...snapshot.suppliers].sort((a, b) => a.supplierId.localeCompare(b.supplierId)),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 3-wayマージの本体。「PLM側が触っていない箇所」はcurrent（相手側の今）を
// 自動採用し、「両方が触っていた箇所」だけをconflictとして人間に上げる。
export function preflightExport(
  session: SyncSession,
  current: MasterSnapshot, // ユーザーが再取得したproduction_system_simの最新
  ourItems: PlmItem[],
  ourMbomLines: PlmBomLine[],
): ExportPreflightResult {
  const conflicts: ConflictDetail[] = [];
  const autoMergedNotes: string[] = [];
  const mergedItems: ItemMaster[] = [];

  const allItemIds = new Set([
    ...session.baseline.items.map((i) => i.itemId),
    ...current.items.map((i) => i.itemId),
    ...ourItems.map((i) => i.itemId),
  ]);
  for (const id of allItemIds) {
    const base = session.baseline.items.find((i) => i.itemId === id);
    const theirs = current.items.find((i) => i.itemId === id);
    const ours = ourItems.find((i) => i.itemId === id);
    const weTouched = session.touchedItemIds.has(id);
    const theyChanged = JSON.stringify(base) !== JSON.stringify(theirs);

    if (weTouched && theyChanged) {
      conflicts.push({ kind: 'item', key: id, baseline: base, ours, theirs });
    } else if (weTouched && ours) {
      mergedItems.push(stripPlmOnlyItemFields(ours));
    } else if (theyChanged && theirs) {
      autoMergedNotes.push(`品目 ${id}：production_system_sim側の変更を自動的に採用しました`);
      mergedItems.push(theirs);
    } else if (base) {
      mergedItems.push(base);
    }
  }
  // BOM行も品目と同じ3値比較パターンで検査する。キーは複合キー
  // `${parentItemId}::${childItemId}`（production_system_simのBomLineには
  // 行ID自体が無いため、この複合キーが実質的な主キーになる）。
  const bomKeyOf = (l: BomLine) => `${l.parentItemId}::${l.childItemId}`;
  const mergedBom: BomLine[] = [];
  const allBomKeys = new Set([
    ...session.baseline.bom.map(bomKeyOf),
    ...current.bom.map(bomKeyOf),
    ...ourMbomLines.filter((l) => !l.isEbomOnly).map(bomKeyOf),
  ]);
  for (const key of allBomKeys) {
    const base = session.baseline.bom.find((l) => bomKeyOf(l) === key);
    const theirs = current.bom.find((l) => bomKeyOf(l) === key);
    const ours = ourMbomLines.find((l) => !l.isEbomOnly && bomKeyOf(l) === key);
    const weTouched = session.touchedBomKeys.has(key);
    const theyChanged = JSON.stringify(base) !== JSON.stringify(theirs);

    if (weTouched && theyChanged) {
      conflicts.push({ kind: 'bomLine', key, baseline: base, ours, theirs });
    } else if (weTouched && ours) {
      mergedBom.push(stripPlmOnlyBomFields(ours));
    } else if (theyChanged && theirs) {
      autoMergedNotes.push(`BOM行 ${key}：production_system_sim側の変更を自動的に採用しました`);
      mergedBom.push(theirs);
    } else if (base) {
      mergedBom.push(base);
    }
  }

  // 作業区・得意先・仕入先（passthrough）はPLM側が一切編集しないため、weTouchedは常にfalseになる。
  // つまりconflictは原理的に起こらず、常にproduction_system_sim側の最新（current）を
  // そのまま採用するだけでよい。工順（routingSteps）は工程としてPLMが持つが（PLM-EXT-17）、
  // 3-wayマージへの組み込みは別途行うため、ここではまだ相手側の最新を採用する。ただしtheirsがbaselineと違えばautoMergedNotesに記録し、
  // 「PLMが把握していない間に何が変わったか」を可視化する（工順・作業区の追加等）。
  const passthroughChanged =
    JSON.stringify(session.baseline.routingSteps) !== JSON.stringify(current.routingSteps) ||
    JSON.stringify(session.baseline.workCenters) !== JSON.stringify(current.workCenters) ||
    JSON.stringify(session.baseline.customers) !== JSON.stringify(current.customers) ||
    JSON.stringify(session.baseline.suppliers) !== JSON.stringify(current.suppliers);
  if (passthroughChanged) {
    autoMergedNotes.push('工順／作業区／得意先／仕入先のいずれかがproduction_system_sim側で変更されています（自動的に最新を採用）');
  }
  const mergedPassthrough: Omit<MasterSnapshot, 'version' | 'items' | 'bom'> = {
    routingSteps: current.routingSteps,
    workCenters: current.workCenters,
    customers: current.customers,
    suppliers: current.suppliers,
  };

  if (conflicts.length > 0) {
    return { status: 'conflict', conflicts };
  }
  return {
    status: autoMergedNotes.length > 0 ? 'autoMerged' : 'clean',
    mergedSnapshot: { version: 1, items: mergedItems, bom: mergedBom, ...mergedPassthrough },
    autoMergedNotes,
  };
}

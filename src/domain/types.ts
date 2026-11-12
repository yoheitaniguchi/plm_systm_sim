// 共有型定義（要件書5章）。
// production_system_sim (`src/types.ts`) と直接互換な型は「共有する型」として
// そのまま踏襲し、PLM独自の拡張はそれらを継承する形で追加する。

// ---------- production_system_simと共有する型（そのまま踏襲） ----------
export type MakeBuy = 'MAKE' | 'BUY';

export interface ItemMaster {
  itemId: string;
  name: string;
  makeBuy: MakeBuy;
  leadTimeDays: number;
  defaultSupplierId?: string;
  purchasePrice?: number;
  salesPrice?: number;
}

export interface BomLine {
  parentItemId: string;
  childItemId: string;
  qtyPer: number;
}

export interface RoutingStep {
  itemId: string;
  stepNo: number;
  workCenter: string;
  stdTimeMin: number;
  setupMin?: number; // 段取り時間（分）。production_system_sim側の任意項目。PLMでは編集せず、取り込んだ値を保って書き出す
}

export interface WorkCenter {
  workCenter: string;
  ratePerHour: number;
  capacityMinPerDay: number;
}

export interface Customer {
  customerId: string;
  name: string;
}

export interface Supplier {
  supplierId: string;
  name: string;
}

// production_system_sim側のマスタ一式（masterIO.tsが入出力する形）。
// 全7フィールド必須。BOM行の配列名は「bom」であり「bomLines」ではない点に注意（Rev.D）。
export interface MasterSnapshot {
  version: 1;
  items: ItemMaster[];
  bom: BomLine[];
  routingSteps: RoutingStep[];
  workCenters: WorkCenter[];
  customers: Customer[];
  suppliers: Supplier[];
}

// PLMが編集せず、取り込んだものをそのまま書き出すマスタ。
// 工順（routingSteps）は工程（Operation）としてPLMが持つため、ここには含めない（PLM-EXT-17）。
export type Passthrough = Pick<MasterSnapshot, 'workCenters' | 'customers' | 'suppliers'>;

// ---------- PLM独自の拡張 ----------
export type ItemLifecycleStatus =
  | '試作'
  | '設計確定'
  | '量産準備中'
  | '量産'
  | '保守専用'
  | '廃止';

// PlmItem = production_system_simのItemMasterに、PLM固有の属性を追加したもの。
// production_system_simへ書き出す際はItemMaster部分のみを取り出す（7.3）。
export interface PlmItem extends ItemMaster {
  lifecycleStatus: ItemLifecycleStatus;
  spec?: string;
  drawingRef?: string; // 文書ドメインへの参照
}

export type BomType = 'E' | 'M';

// PlmBomLine = production_system_simのBomLineに、PLM固有の属性を追加したもの。
// M-BOM書き出し時はparentItemId/childItemId/qtyPerのみを取り出す（7.2, 7.3）。
export interface PlmBomLine extends BomLine {
  bomLineId: string;
  bomType: BomType;
  version: number;
  effectiveFromDay: number; // production_system_simに合わせ、D0起点の整数日数
  effectiveToDay?: number;
  // M-BOMのみ：投入工程。この子品目を、親品目（parentItemId）のどの工程で投入するかを、
  // 親品目の工程コード（Operation.opCode）で指す（PLM-EXT-18）。未割当ならundefined。PLM独自で、書き出さない
  processStep?: string;
  // M-BOMのみ：この行を作った変換の範囲（PLM-EXT-16）。バリアント構成を指定した変換では確定品目コード、
  // 構成なしの変換では未設定。再変換のとき、同じ範囲の行だけを突き合わせる対象にする
  mbomScope?: string;
  isEbomOnly?: boolean; // 脚部ユニットのようなE-BOM限定の機能グループ（4.1）
  optionGroupId?: string; // このBOM行が属するオプショングループ（未設定なら固定行、4.4）
  optionCode?: string; // optionGroupId設定時のみ有効：このBOM行が表すオプションの識別子
  alternateGroupId?: string; // このBOM行が属する代替部品グループ（4.5）
  alternatePriority?: number; // 代替部品グループ内の優先順位（小さいほど優先）
  approvalStatus?: '承認済' | '評価中' | '却下'; // 代替部品として選択可能かどうか（承認済のみ選択可）
}

// ---------- 工程（BOP、PLM-EXT-17） ----------
// 内製品目ごとの工程。BOM行と同じ「版数＋有効日」で改訂の履歴を残す。
// production_system_simへは、現在有効な工程のitemId/stepNo/workCenter/stdTimeMin/setupMinだけを
// routingStepsとして書き出す。opCode・name・descriptionはPLM独自で、書き出さない。
export interface Operation {
  operationId: string; // 内部ID。版ごとに別
  itemId: string; // 工程を持つ内製品目
  opCode: string; // 工程コード。品目内で一意で、版・順序が変わっても不変（参照のキー）
  stepNo: number; // 順序。正の整数で、現在有効な工程の中で品目内一意（RoutingStep.stepNo）
  name: string;
  description?: string;
  workCenter: string; // 取り込み済みの作業区（passthrough.workCenters）のいずれか
  stdTimeMin: number;
  setupMin?: number;
  version: number;
  effectiveFromDay: number;
  effectiveToDay?: number;
  changeId?: string; // 由来のECO（任意）
}

// バリアント構成の選択結果（4.4）。1つの構成が1つの具体的な品目に対応する。
export interface Configuration {
  configId: string;
  baseItemId: string; // 元になる品目（例：FG-100）
  selections: Record<string, string>; // optionGroupId -> optionCode
  resolvedItemId: string; // 構成解決後に確定する品目コード（例：FG-101）
}

// ---------- 変更管理 ----------
export type ChangeType = 'ECR' | 'ECO' | 'ECN';

export type ChangeStatus =
  | '起票'
  | '審査中'
  | '却下'
  | '承認_影響分析中'
  | 'ECO発行'
  | 'ECN通知済'
  | 'クローズ'
  | '取消';

export type Disposition = '即時廃却' | '使い切り' | '手直し' | '代替品への置き換え';

// 統制語彙（Rev.G）。自由記述だとKPI集計（知識体系6.3節）ができないため型で縛る。
// 自由記述が必要な場合はreasonDetailに書く。
export type ChangeReason =
  | 'コスト削減'
  | '品質・安全'
  | '顧客要求'
  | '陳腐化'
  | '規制対応'
  | 'その他';

export interface ApproverDecision {
  approverRole: '設計リーダー' | '品質保証' | '製造' | '調達';
  decision: '承認' | '却下' | '保留';
  decidedAtDay?: number;
}

export interface EngineeringChange {
  changeId: string;
  type: ChangeType;
  status: ChangeStatus;
  reason: ChangeReason;
  reasonDetail?: string; // 統制語彙で表現しきれない補足（任意の自由記述）
  changeLevel: '軽微' | '重大';
  raisedByRole?: '設計' | '品質保証' | '製造' | '調達'; // 起票元（現場フィードバックループ、UC-ECM-5）
  requiredApproverRoles?: ApproverDecision['approverRole'][]; // 重大変更で必須のロール集合（7.5）
  impactedItemIds: string[];
  impactedBomLineIds: string[];
  effectiveFromDay?: number;
  disposition?: Disposition;
  approvals: ApproverDecision[];
  // ECR起票時点のM-BOMスナップショット（PLM-EXT-14）。原価影響（7.7）のbefore基準として使う。
  // E-BOM側は対象外（既存方針を踏襲、design.md PLM-EXT-14参照）。
  beforeBomLines?: PlmBomLine[];
}

// ---------- 文書 ----------
export interface DesignDocument {
  docId: string;
  version: number;
  relatedItemId: string;
  docType: '図面' | '仕様書';
}

// ---------- マスタ連携イベント（Rev.H：取消可否判定に使用） ----------
export type SyncEventStatus = '送信済';

export interface SyncEvent {
  eventId: string;
  sourceChangeId: string; // このエクスポートの元になったEngineeringChange.changeId
  status: SyncEventStatus;
  exportedAtDay: number;
}

// ---------- SSOT競合検知（9.6） ----------
// PLMシミュレーターがMasterSnapshotをインポートした時点から、エクスポートするまでの
// 「セッション」を表す。インポート時点のスナップショット全体をベースラインとして保持し、
// その後PLM側が実際に変更した品目・BOM行のキーを蓄積する（複数のECOにまたがってよい）。
export interface SyncSession {
  importedAtDay: number;
  baseline: MasterSnapshot;
  touchedItemIds: Set<string>;
  touchedBomKeys: Set<string>; // `${parentItemId}::${childItemId}` 形式
}

export interface ConflictDetail {
  kind: 'item' | 'bomLine' | 'passthrough';
  key: string;
  baseline: unknown;
  ours: unknown; // PLM側で変更した後の値
  theirs: unknown; // production_system_sim側の現在値（再取得したスナップショットより）
}

export interface ExportPreflightResult {
  status: 'clean' | 'autoMerged' | 'conflict';
  mergedSnapshot?: MasterSnapshot; // status !== 'conflict' の場合のみ
  conflicts?: ConflictDetail[]; // status === 'conflict' の場合のみ
  autoMergedNotes?: string[]; // 参考情報：自動的に取り込んだ相手側の変更点
}

export const MAX_BOM_DEPTH = 20; // production_system_simの制約を踏襲

export type ItemCodePrefix = 'FG' | 'SA' | 'RM' | 'PT';

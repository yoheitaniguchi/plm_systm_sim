// 教材用サンプル製品（4章）：木製イス（基礎）・自転車（応用）。
import { addEbomLine } from './ebom';
import { createItem } from './item';
import type { AppState } from './reducer';
import { createInitialState } from './reducer';
import type { MasterSnapshot, PlmBomLine } from './types';

// 4.1: production_system_simが実際にエクスポートする木製イすのMasterSnapshot（フラットなBOM）。
// マスタ連携ドメインのUC-SYNC-1（インポート）で使う、素の交換用データ。
export const woodenChairMasterSnapshot: MasterSnapshot = {
  version: 1,
  items: [
    { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, salesPrice: 6000 },
    { itemId: 'SA-200', name: '座面ASSY', makeBuy: 'MAKE', leadTimeDays: 1 },
    { itemId: 'RM-300', name: '木板', makeBuy: 'BUY', leadTimeDays: 5, purchasePrice: 800, defaultSupplierId: 'SUP-1' },
    { itemId: 'PT-400', name: '脚', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 250, defaultSupplierId: 'SUP-2' },
    { itemId: 'PT-500', name: 'ネジ', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 20, defaultSupplierId: 'SUP-2' },
  ],
  bom: [
    { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1 },
    { parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1 },
    { parentItemId: 'FG-100', childItemId: 'PT-400', qtyPer: 4 },
    { parentItemId: 'FG-100', childItemId: 'PT-500', qtyPer: 8 },
  ],
  routingSteps: [
    { itemId: 'SA-200', stepNo: 1, workCenter: 'WC-CUT', stdTimeMin: 18 },
    { itemId: 'FG-100', stepNo: 1, workCenter: 'WC-ASM', stdTimeMin: 30 },
    { itemId: 'FG-100', stepNo: 2, workCenter: 'WC-INS', stdTimeMin: 12 },
  ],
  workCenters: [
    { workCenter: 'WC-CUT', ratePerHour: 2400, capacityMinPerDay: 480 },
    { workCenter: 'WC-ASM', ratePerHour: 2400, capacityMinPerDay: 480 },
    { workCenter: 'WC-INS', ratePerHour: 2400, capacityMinPerDay: 480 },
  ],
  customers: [{ customerId: 'CUST-1', name: 'お客様A' }],
  suppliers: [
    { supplierId: 'SUP-1', name: '木材屋' },
    { supplierId: 'SUP-2', name: '金物屋' },
    { supplierId: 'SUP-3', name: '代替金物屋' },
  ],
};

// 4.2: 自転車（応用シナリオ）。4階層BOMのため、より複雑な影響分析・変更波及の練習に使う。
export const bicycleMasterSnapshot: MasterSnapshot = {
  version: 1,
  items: [
    { itemId: 'FG-700', name: '自転車', makeBuy: 'MAKE', leadTimeDays: 2, salesPrice: 15000 },
    { itemId: 'SA-710', name: '車輪ASSY', makeBuy: 'MAKE', leadTimeDays: 1 },
    { itemId: 'SA-720', name: 'リムASSY', makeBuy: 'MAKE', leadTimeDays: 1 },
    { itemId: 'RM-730', name: 'アルミリム材', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 300, defaultSupplierId: 'SUP-1' },
    { itemId: 'PT-740', name: 'フレーム', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 4000, defaultSupplierId: 'SUP-2' },
  ],
  bom: [
    { parentItemId: 'FG-700', childItemId: 'SA-710', qtyPer: 2 },
    { parentItemId: 'SA-710', childItemId: 'SA-720', qtyPer: 1 },
    { parentItemId: 'SA-720', childItemId: 'RM-730', qtyPer: 1 },
    { parentItemId: 'FG-700', childItemId: 'PT-740', qtyPer: 1 },
  ],
  routingSteps: [],
  workCenters: [],
  customers: [{ customerId: 'CUST-1', name: 'お客様A' }],
  suppliers: [
    { supplierId: 'SUP-1', name: '木材屋' },
    { supplierId: 'SUP-2', name: '金物屋' },
  ],
};

// 4.1・4.4・4.5: PLM側がすでに「脚部ユニット」の機能グルーピング・座面バリアント・
// 代替部品グループを追加した状態のE-BOMを、アプリ初回起動時の既定状態として用意する
// （UC-UI-1のオンボーディングがすぐに木製イスのE-BOM構造を見せられるようにするため）。
export function createWoodenChairDemoState(): AppState {
  const state = createInitialState();
  state.passthrough = {
    routingSteps: woodenChairMasterSnapshot.routingSteps,
    workCenters: woodenChairMasterSnapshot.workCenters,
    customers: woodenChairMasterSnapshot.customers,
    suppliers: woodenChairMasterSnapshot.suppliers,
  };
  state.syncSession = {
    importedAtDay: 0,
    baseline: woodenChairMasterSnapshot,
    touchedItemIds: new Set(),
    touchedBomKeys: new Set(),
  };

  createItem(state.items, { itemId: 'FG-100', name: '木製イス', makeBuy: 'MAKE', leadTimeDays: 2, salesPrice: 6000, lifecycleStatus: '量産' });
  createItem(state.items, { itemId: 'SA-200', name: '座面ASSY', makeBuy: 'MAKE', leadTimeDays: 1, lifecycleStatus: '量産' });
  createItem(state.items, { itemId: 'RM-300', name: '木板（無垢材）', makeBuy: 'BUY', leadTimeDays: 5, purchasePrice: 800, defaultSupplierId: 'SUP-1', lifecycleStatus: '量産' });
  createItem(state.items, { itemId: 'RM-301', name: 'クッション材（布張り）', makeBuy: 'BUY', leadTimeDays: 4, purchasePrice: 1200, defaultSupplierId: 'SUP-1', lifecycleStatus: '設計確定' });
  createItem(state.items, { itemId: 'PT-400', name: '脚（標準）', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 250, defaultSupplierId: 'SUP-2', lifecycleStatus: '量産' });
  createItem(state.items, { itemId: 'PT-401', name: '脚（代替品B）', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 220, defaultSupplierId: 'SUP-3', lifecycleStatus: '量産' });
  createItem(state.items, { itemId: 'PT-500', name: 'ネジ', makeBuy: 'BUY', leadTimeDays: 3, purchasePrice: 20, defaultSupplierId: 'SUP-2', lifecycleStatus: '量産' });

  addEbomLine(state.bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(state.bomLines, {
    bomLineId: 'E-2',
    parentItemId: 'SA-200',
    childItemId: 'RM-300',
    qtyPer: 1,
    effectiveFromDay: 0,
    optionGroupId: 'OG-SEAT-FINISH',
    optionCode: '無垢材',
  });
  addEbomLine(state.bomLines, {
    bomLineId: 'E-3',
    parentItemId: 'SA-200',
    childItemId: 'RM-301',
    qtyPer: 1,
    effectiveFromDay: 0,
    optionGroupId: 'OG-SEAT-FINISH',
    optionCode: '布張り',
  });
  // 「脚部ユニット」はE-BOMのみに存在する機能グループ（4.1）。EU-450は品目マスタには
  // 登録しない（M-BOM変換時にグループごと消滅し、production_system_sim側には現れないため）。
  addEbomLine(state.bomLines, { bomLineId: 'E-4', parentItemId: 'FG-100', childItemId: 'EU-450', qtyPer: 1, effectiveFromDay: 0, isEbomOnly: false });
  addEbomLine(state.bomLines, {
    bomLineId: 'E-5',
    parentItemId: 'EU-450',
    childItemId: 'PT-400',
    qtyPer: 4,
    effectiveFromDay: 0,
    isEbomOnly: true,
  });
  addEbomLine(state.bomLines, {
    bomLineId: 'E-6',
    parentItemId: 'EU-450',
    childItemId: 'PT-500',
    qtyPer: 8,
    effectiveFromDay: 0,
    isEbomOnly: true,
  });
  addEbomLine(state.bomLines, {
    bomLineId: 'E-7',
    parentItemId: 'EU-450',
    childItemId: 'PT-401',
    qtyPer: 4,
    effectiveFromDay: 0,
    isEbomOnly: true,
  });

  // 4.5: 代替部品グループ（脚）。承認済のみ選択可能で、既定は優先順位1位のPT-400。
  setAlternateGroupFields(state.bomLines, 'EU-450', 'PT-400', 'AG-LEG', 1, '承認済');
  setAlternateGroupFields(state.bomLines, 'EU-450', 'PT-401', 'AG-LEG', 2, '承認済');

  return state;
}

function setAlternateGroupFields(
  bomLines: PlmBomLine[],
  parentItemId: string,
  childItemId: string,
  alternateGroupId: string,
  alternatePriority: number,
  approvalStatus: NonNullable<PlmBomLine['approvalStatus']>,
): void {
  const line = bomLines.find((l) => l.parentItemId === parentItemId && l.childItemId === childItemId);
  if (!line) throw new Error(`BOM行 ${parentItemId} -> ${childItemId} が見つかりません`);
  line.alternateGroupId = alternateGroupId;
  line.alternatePriority = alternatePriority;
  line.approvalStatus = approvalStatus;
}

// 4.1: 木製イスの工順マップ（M-BOM変換時にprocessStepへ引き渡す）。
export const woodenChairRoutingMap: Record<string, string> = {
  'SA-200': 'WC-CUT',
  'PT-400': 'WC-ASM',
  'PT-401': 'WC-ASM',
  'PT-500': 'WC-ASM',
};

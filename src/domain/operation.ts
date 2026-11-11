// 工程（BOP）ドメイン：内製品目ごとの工程の追加・改訂・順序変更・終了と、
// MasterSnapshotの工順（routingSteps）との相互変換（design.md PLM-EXT-17）。
// 版の扱いはE-BOM行（ebom.reviseEbomLine）と同じ：旧版はeffectiveToDayを設定して残し、新しい版を追加する。
import type { Operation, PlmItem, RoutingStep, WorkCenter } from './types';

// 新しい工程に振る順序の間隔。production_system_simの工順が10刻み（10, 20, …）であることに合わせる
export const STEP_NO_INTERVAL = 10;

// 現在有効な工程（旧版化・終了していないもの）。itemIdを渡すとその品目の工程だけを順序どおりに返す。
// 品目を絞らない場合は、品目が最初に現れた順にまとめて返す。
export function currentOperations(operations: Operation[], itemId?: string): Operation[] {
  const current = operations.filter(
    (o) => o.effectiveToDay === undefined && (itemId === undefined || o.itemId === itemId),
  );
  const itemOrder = [...new Set(current.map((o) => o.itemId))];
  return itemOrder.flatMap((id) => current.filter((o) => o.itemId === id).sort((a, b) => a.stepNo - b.stepNo));
}

// 取り込み：工順の各行を工程にする。工程コードは「OP＋stepNo」、名称は「工程{stepNo}」とする
// （MasterSnapshotには工程の名称が無いため）。
export function operationsFromRoutingSteps(routingSteps: RoutingStep[], effectiveFromDay = 0): Operation[] {
  return routingSteps.map((step, idx) => {
    const operation: Operation = {
      operationId: `OPN-IMPORT-${idx}`,
      itemId: step.itemId,
      opCode: `OP${step.stepNo}`,
      stepNo: step.stepNo,
      name: `工程${step.stepNo}`,
      workCenter: step.workCenter,
      stdTimeMin: step.stdTimeMin,
      version: 1,
      effectiveFromDay,
    };
    if (step.setupMin !== undefined) operation.setupMin = step.setupMin;
    return operation;
  });
}

// 書き出し：現在有効な工程を工順にする。品目は最初に現れた順、品目内はstepNo順。
// setupMinは値があるときだけ出す（取り込んだ値を落とさない）。
export function routingStepsFromOperations(operations: Operation[]): RoutingStep[] {
  return currentOperations(operations).map((o) => {
    const step: RoutingStep = {
      itemId: o.itemId,
      stepNo: o.stepNo,
      workCenter: o.workCenter,
      stdTimeMin: o.stdTimeMin,
    };
    if (o.setupMin !== undefined) step.setupMin = o.setupMin;
    return step;
  });
}

// 品目ごとの「最初の工程」（順序が最小の現在有効な工程）の工程コード。
// M-BOM変換で、子品目の投入工程の既定値に使う（PLM-EXT-18）。
export function firstOperationCodes(operations: Operation[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const o of currentOperations(operations)) {
    if (!(o.itemId in result)) result[o.itemId] = o.opCode;
  }
  return result;
}

function assertWorkCenterImported(workCenters: WorkCenter[], workCenter: string): void {
  if (workCenters.length === 0) {
    throw new Error('作業区がありません。作業区は生産管理側のマスタです。MasterSnapshotを取り込んでください');
  }
  if (!workCenters.some((w) => w.workCenter === workCenter)) {
    throw new Error(`作業区 ${workCenter} は取り込み済みの作業区にありません`);
  }
}

function assertStdTime(stdTimeMin: number): void {
  if (!Number.isFinite(stdTimeMin) || stdTimeMin < 0) {
    throw new Error('標準時間は0以上の数値である必要があります');
  }
}

// 有効日はD0起点の整数日数。NaNや小数が入ると、以後の「旧版より後」の比較が効かなくなる
function assertDay(day: number, label: string): void {
  if (!Number.isInteger(day) || day < 0) {
    throw new Error(`${label}は0以上の整数（日数）である必要があります`);
  }
}

export interface NewOperationInput {
  operationId: string;
  itemId: string;
  opCode?: string; // 省略時は「OP＋順序」から自動で決める
  name: string;
  description?: string;
  workCenter: string;
  stdTimeMin: number;
  effectiveFromDay: number;
  changeId?: string;
}

// 工程を品目の末尾に追加する（版数1）。
// 工程コードは、終了・旧版化した工程を含めて品目内で再利用しない（履歴の中で別の工程を指さないようにするため）。
export function addOperation(
  operations: Operation[],
  items: PlmItem[],
  workCenters: WorkCenter[],
  input: NewOperationInput,
): Operation {
  const item = items.find((i) => i.itemId === input.itemId);
  if (!item) throw new Error(`品目 ${input.itemId} が見つかりません`);
  if (item.makeBuy !== 'MAKE') throw new Error(`品目 ${input.itemId} は購買品目のため工程を登録できません`);
  if (input.name.trim() === '') throw new Error('工程の名称を入力してください');
  assertWorkCenterImported(workCenters, input.workCenter);
  assertStdTime(input.stdTimeMin);
  assertDay(input.effectiveFromDay, '有効開始日');

  const current = currentOperations(operations, input.itemId);
  const stepNo = current.reduce((max, o) => Math.max(max, o.stepNo), 0) + STEP_NO_INTERVAL;
  const usedCodes = new Set(operations.filter((o) => o.itemId === input.itemId).map((o) => o.opCode));
  let opCode = input.opCode?.trim();
  if (opCode !== undefined && opCode !== '') {
    if (usedCodes.has(opCode)) {
      throw new Error(`工程コード ${opCode} は品目 ${input.itemId} で既に使われています`);
    }
  } else {
    let n = stepNo;
    while (usedCodes.has(`OP${n}`)) n += STEP_NO_INTERVAL;
    opCode = `OP${n}`;
  }

  const operation: Operation = {
    operationId: input.operationId,
    itemId: input.itemId,
    opCode,
    stepNo,
    name: input.name.trim(),
    workCenter: input.workCenter,
    stdTimeMin: input.stdTimeMin,
    version: 1,
    effectiveFromDay: input.effectiveFromDay,
  };
  if (input.description !== undefined && input.description !== '') operation.description = input.description;
  if (input.changeId !== undefined) operation.changeId = input.changeId;
  operations.push(operation);
  return operation;
}

function findCurrentOperation(operations: Operation[], operationId: string): Operation {
  const operation = operations.find((o) => o.operationId === operationId);
  if (!operation) throw new Error(`工程 ${operationId} が見つかりません`);
  if (operation.effectiveToDay !== undefined) {
    throw new Error(`工程 ${operation.opCode}（${operation.itemId}）は既に旧版化または終了しています`);
  }
  return operation;
}

function assertLaterThan(operation: Operation, effectiveFromDay: number): void {
  assertDay(effectiveFromDay, '有効開始日');
  if (effectiveFromDay <= operation.effectiveFromDay) {
    throw new Error(
      `新しい版の有効開始日は旧版より後である必要があります（工程 ${operation.opCode} の現在の版は${operation.effectiveFromDay}日目から有効）`,
    );
  }
}

export type OperationPatch = Partial<Pick<Operation, 'name' | 'description' | 'workCenter' | 'stdTimeMin'>>;

// 工程を改訂する。旧版はeffectiveToDayを設定して残し、版数を上げた工程を追加する。
// 工程コード・順序・段取り時間は改訂で変わらない（順序はreorderOperationsで変える）。
export function reviseOperation(
  operations: Operation[],
  workCenters: WorkCenter[],
  operationId: string,
  patch: OperationPatch,
  newOperationId: string,
  effectiveFromDay: number,
  changeId?: string,
): Operation {
  const old = findCurrentOperation(operations, operationId);
  assertLaterThan(old, effectiveFromDay);
  if (patch.name !== undefined && patch.name.trim() === '') throw new Error('工程の名称を入力してください');
  if (patch.workCenter !== undefined) assertWorkCenterImported(workCenters, patch.workCenter);
  if (patch.stdTimeMin !== undefined) assertStdTime(patch.stdTimeMin);

  old.effectiveToDay = effectiveFromDay;
  const revised: Operation = {
    ...old,
    operationId: newOperationId,
    version: old.version + 1,
    effectiveFromDay,
    effectiveToDay: undefined,
  };
  // 値がundefinedの項目は「変更なし」として扱う（スプレッドで必須項目を消さない）
  if (patch.name !== undefined) revised.name = patch.name.trim();
  if (patch.workCenter !== undefined) revised.workCenter = patch.workCenter;
  if (patch.stdTimeMin !== undefined) revised.stdTimeMin = patch.stdTimeMin;
  if (patch.description !== undefined) revised.description = patch.description;
  if (revised.description === '') delete revised.description;
  delete revised.changeId; // 旧版の由来は引き継がない
  if (changeId !== undefined) revised.changeId = changeId;
  operations.push(revised);
  return revised;
}

// 工程の順序を入れ替える。品目の現在の順序の値（stepNo）の集合はそのままに、
// 指定した並び（工程コードの配列）へ割り当て直す。順序が変わる工程だけ版を上げる（改訂と同じ扱い）。
// どれか1つでも版を上げられない場合は、何も変えずに拒否する。
export function reorderOperations(
  operations: Operation[],
  itemId: string,
  opCodesInOrder: string[],
  newOperationId: () => string,
  effectiveFromDay: number,
  changeId?: string,
): Operation[] {
  const current = currentOperations(operations, itemId);
  const currentCodes = current.map((o) => o.opCode);
  const sameSet =
    opCodesInOrder.length === currentCodes.length &&
    new Set(opCodesInOrder).size === opCodesInOrder.length &&
    opCodesInOrder.every((code) => currentCodes.includes(code));
  if (!sameSet) {
    throw new Error(`順序の指定が、品目 ${itemId} の現在の工程（${currentCodes.join('、')}）と一致しません`);
  }

  const stepNos = current.map((o) => o.stepNo); // 昇順
  const moved = opCodesInOrder
    .map((code, idx) => ({ old: current.find((o) => o.opCode === code)!, stepNo: stepNos[idx] }))
    .filter(({ old, stepNo }) => old.stepNo !== stepNo);
  for (const { old } of moved) assertLaterThan(old, effectiveFromDay);

  return moved.map(({ old, stepNo }) => {
    old.effectiveToDay = effectiveFromDay;
    const revised: Operation = {
      ...old,
      operationId: newOperationId(),
      stepNo,
      version: old.version + 1,
      effectiveFromDay,
      effectiveToDay: undefined,
    };
    delete revised.changeId;
    if (changeId !== undefined) revised.changeId = changeId;
    operations.push(revised);
    return revised;
  });
}

// 工程を終了する（削除はしない。effectiveToDayを設定して履歴に残す）。
export function endOperation(operations: Operation[], operationId: string, effectiveToDay: number): Operation {
  const operation = findCurrentOperation(operations, operationId);
  assertDay(effectiveToDay, '終了日');
  if (effectiveToDay < operation.effectiveFromDay) {
    throw new Error(
      `終了日（${effectiveToDay}日目）が、工程 ${operation.opCode} の有効開始日（${operation.effectiveFromDay}日目）より前です`,
    );
  }
  operation.effectiveToDay = effectiveToDay;
  return operation;
}

// 現在有効な工程の検査。書き出し前に使う（production_system_sim側の取り込みが拒否する内容を先に見つける）。
export function checkOperations(operations: Operation[], items: PlmItem[], workCenters: WorkCenter[]): string[] {
  const problems: string[] = [];
  const itemById = new Map(items.map((i) => [i.itemId, i]));
  const workCenterIds = new Set(workCenters.map((w) => w.workCenter));
  const seenStep = new Set<string>();
  const seenCode = new Set<string>();

  for (const o of operations.filter((op) => op.effectiveToDay === undefined)) {
    if (!itemById.has(o.itemId)) {
      problems.push(`工順が参照する品目 ${o.itemId} が品目マスタから削除されています`);
    }
    if (!workCenterIds.has(o.workCenter)) {
      problems.push(`工順が参照する作業区 ${o.workCenter} が存在しません`);
    }
    if (!Number.isInteger(o.stepNo) || o.stepNo <= 0) {
      problems.push(`品目 ${o.itemId} の工程 ${o.opCode} の順序（${o.stepNo}）が正の整数ではありません`);
    }
    const stepKey = `${o.itemId}:${o.stepNo}`;
    if (seenStep.has(stepKey)) problems.push(`品目 ${o.itemId} の工程の順序 ${o.stepNo} が重複しています`);
    seenStep.add(stepKey);
    const codeKey = `${o.itemId}:${o.opCode}`;
    if (seenCode.has(codeKey)) problems.push(`品目 ${o.itemId} の工程コード ${o.opCode} が重複しています`);
    seenCode.add(codeKey);
  }
  return problems;
}

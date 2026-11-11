// 資源（BOR）ドメイン：工程ごとの設備・治具工具・作業者スキル（design.md PLM-EXT-19）。
// 原価・能力の計算には使わない。PLM側だけの情報で、MasterSnapshotには書き出さない。
import type { Operation, OperationResource, ResourceKind } from './types';

export const RESOURCE_KINDS: ResourceKind[] = ['設備', '治具・工具', '作業者スキル'];

export interface NewResourceInput {
  resourceId: string;
  itemId: string;
  opCode: string;
  kind: ResourceKind;
  code: string;
  name: string;
  requiredQty?: number;
  requiredTimeMin?: number;
}

// 工程に資源を追加する。対象は現在有効な工程だけ。必要数と必要時間は、どちらか一方を正の数で指定する。
// 同じ工程に、同じ種別・同じコードの資源は重ねて登録できない。
export function addResource(
  resources: OperationResource[],
  operations: Operation[],
  input: NewResourceInput,
): OperationResource {
  const operation = operations.find(
    (o) => o.itemId === input.itemId && o.opCode === input.opCode && o.effectiveToDay === undefined,
  );
  if (!operation) {
    throw new Error(`工程 ${input.opCode} は、品目 ${input.itemId} の現在有効な工程にありません`);
  }
  if (!RESOURCE_KINDS.includes(input.kind)) throw new Error(`資源の種別 ${String(input.kind)} が不正です`);
  const code = input.code.trim();
  const name = input.name.trim();
  if (code === '') throw new Error('資源のコードを入力してください');
  if (name === '') throw new Error('資源の名称を入力してください');

  const hasQty = input.requiredQty !== undefined;
  const hasTime = input.requiredTimeMin !== undefined;
  if (hasQty === hasTime) throw new Error('必要数と必要時間は、どちらか一方を指定してください');
  const amount = hasQty ? input.requiredQty! : input.requiredTimeMin!;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${hasQty ? '必要数' : '必要時間'}は0より大きい数値である必要があります`);
  }
  if (resources.some((r) => r.itemId === input.itemId && r.opCode === input.opCode && r.kind === input.kind && r.code === code)) {
    throw new Error(`工程 ${input.opCode}（${input.itemId}）には、${input.kind} ${code} が既に登録されています`);
  }

  const resource: OperationResource = {
    resourceId: input.resourceId,
    itemId: input.itemId,
    opCode: input.opCode,
    kind: input.kind,
    code,
    name,
  };
  if (hasQty) resource.requiredQty = amount;
  else resource.requiredTimeMin = amount;
  resources.push(resource);
  return resource;
}

// 資源を削除する。版管理をしないので、履歴は残らない。
export function removeResource(resources: OperationResource[], resourceId: string): void {
  const index = resources.findIndex((r) => r.resourceId === resourceId);
  if (index < 0) throw new Error(`資源 ${resourceId} が見つかりません`);
  resources.splice(index, 1);
}

export function resourcesOfOperation(resources: OperationResource[], itemId: string, opCode: string): OperationResource[] {
  return resources.filter((r) => r.itemId === itemId && r.opCode === opCode);
}

export interface ResourceUsage {
  kind: ResourceKind;
  code: string;
  names: string[]; // 同じコードに付けられた名称（登録ごとに入力するため、揺れがあれば複数になる）
  usedBy: { itemId: string; opCode: string; requiredQty?: number; requiredTimeMin?: number }[];
}

// 全工程を横断した資源の一覧：どの資源（種別＋コード）が、どの工程で要るか。
export function summarizeResourceUsage(resources: OperationResource[]): ResourceUsage[] {
  const byKey = new Map<string, ResourceUsage>();
  for (const r of resources) {
    const key = `${r.kind}::${r.code}`;
    const usage = byKey.get(key) ?? { kind: r.kind, code: r.code, names: [], usedBy: [] };
    if (!usage.names.includes(r.name)) usage.names.push(r.name);
    const use: ResourceUsage['usedBy'][number] = { itemId: r.itemId, opCode: r.opCode };
    if (r.requiredQty !== undefined) use.requiredQty = r.requiredQty;
    if (r.requiredTimeMin !== undefined) use.requiredTimeMin = r.requiredTimeMin;
    usage.usedBy.push(use);
    byKey.set(key, usage);
  }
  return [...byKey.values()].sort(
    (a, b) => RESOURCE_KINDS.indexOf(a.kind) - RESOURCE_KINDS.indexOf(b.kind) || a.code.localeCompare(b.code),
  );
}

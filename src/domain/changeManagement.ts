// 変更管理（ECM）ドメイン：ECR/ECO/ECN状態遷移、影響分析（3章#4、6.2、7.5）。
import type {
  ApproverDecision,
  ChangeReason,
  ChangeStatus,
  EngineeringChange,
  PlmBomLine,
  SyncEvent,
} from './types';

export type ApprovalAggregate = '審査中' | '承認' | '却下';

const DEFAULT_REQUIRED_ROLES: ApproverDecision['approverRole'][] = ['設計リーダー', '品質保証', '製造'];

// 7.5: 承認集計ルール。重大変更は必須ロール全員の承認が必要、1人でも却下すれば即座に却下。
export function aggregateApprovalStatus(change: EngineeringChange): ApprovalAggregate {
  const required =
    change.changeLevel === '重大' ? change.requiredApproverRoles ?? DEFAULT_REQUIRED_ROLES : ['設計リーダー'];

  const decisions = required.map(
    (role) => change.approvals.find((a) => a.approverRole === role)?.decision ?? '保留',
  );

  if (decisions.some((d) => d === '却下')) return '却下'; // 1人でも却下なら即却下
  if (decisions.every((d) => d === '承認')) return '承認'; // 全員承認して初めて承認
  return '審査中'; // 保留が残っていればまだ審査中
}

// 7.5: disposition「使い切り」の実効性についての警告（拒否はしない）。
export function checkDispositionFeasibility(change: EngineeringChange): string | null {
  if (change.disposition === '使い切り') {
    return (
      'この連携方式（ファイルベースの全量置換）では、在庫消化を待った段階的な切替はできません。' +
      'エクスポートすると即座に切り替わります。段階切替が必要な場合は、実際に在庫が消化されてから' +
      'ECOをクローズ・エクスポートする運用でカバーしてください。'
    );
  }
  return null;
}

// 7.5（Rev.H追加）: 取消可否の判定。対応するSyncEventが送信済ならもう取り消せない。
export function checkWithdrawable(
  change: EngineeringChange,
  syncEvents: SyncEvent[],
): { canWithdraw: boolean; reason?: string } {
  const relatedEvent = syncEvents.find((e) => e.sourceChangeId === change.changeId);
  if (relatedEvent && relatedEvent.status === '送信済') {
    return {
      canWithdraw: false,
      reason: 'このECOは既にエクスポート済みのため取り消せません。新しいECRとして差し戻しを起票してください。',
    };
  }
  return { canWithdraw: true };
}

export interface NewChangeRequestInput {
  changeId: string;
  reason: ChangeReason;
  reasonDetail?: string;
  changeLevel: '軽微' | '重大';
  raisedByRole?: EngineeringChange['raisedByRole'];
  requiredApproverRoles?: ApproverDecision['approverRole'][];
  impactedItemIds: string[];
  impactedBomLineIds: string[];
  disposition?: EngineeringChange['disposition'];
}

// UC-ECM-1: ECRを起票すると、ステータス「起票」で作成される。
// UC-ECM-5: raisedByRoleを指定すれば、起票元が記録される（現場フィードバックループ）。
// PLM-EXT-14: 起票時点の実効M-BOM（currentMbomLines）をstructuredCloneして
// beforeBomLinesとして記録し、後で原価影響（7.7）のbefore基準に使う。
export function createChangeRequest(
  changes: EngineeringChange[],
  input: NewChangeRequestInput,
  currentMbomLines: PlmBomLine[] = [],
): EngineeringChange {
  if (changes.some((c) => c.changeId === input.changeId)) {
    throw new Error(`変更ID ${input.changeId} は既に登録されています`);
  }
  const change: EngineeringChange = {
    ...input,
    type: 'ECR',
    status: '起票',
    approvals: [],
    beforeBomLines: structuredClone(currentMbomLines),
  };
  changes.push(change);
  return change;
}

function getChange(changes: EngineeringChange[], changeId: string): EngineeringChange {
  const change = changes.find((c) => c.changeId === changeId);
  if (!change) throw new Error(`変更 ${changeId} が見つかりません`);
  return change;
}

function assertStatus(change: EngineeringChange, expected: ChangeStatus): void {
  if (change.status !== expected) {
    throw new Error(`変更 ${change.changeId} は現在「${change.status}」のため、この操作はできません`);
  }
}

// 起票 -> 審査中
export function submitForReview(changes: EngineeringChange[], changeId: string): EngineeringChange {
  const change = getChange(changes, changeId);
  assertStatus(change, '起票');
  change.status = '審査中';
  return change;
}

// 審査中の変更に対して、承認者の判断を記録する。全員承認がそろえば自動で
// 「承認_影響分析中」へ、1人でも却下すれば自動で「却下」へ遷移する（UC-ECM-2/3/7）。
export function recordApproval(
  changes: EngineeringChange[],
  changeId: string,
  decision: ApproverDecision,
): EngineeringChange {
  const change = getChange(changes, changeId);
  assertStatus(change, '審査中');

  const existing = change.approvals.find((a) => a.approverRole === decision.approverRole);
  if (existing) {
    existing.decision = decision.decision;
    existing.decidedAtDay = decision.decidedAtDay;
  } else {
    change.approvals.push(decision);
  }

  const aggregate = aggregateApprovalStatus(change);
  if (aggregate === '却下') {
    change.status = '却下';
  } else if (aggregate === '承認') {
    change.status = '承認_影響分析中';
  }
  return change;
}

// 承認_影響分析中 -> ECO発行（effectiveFromDayの設定を不変条件とする、UC-ECM-4）。
export function issueEco(
  changes: EngineeringChange[],
  changeId: string,
  effectiveFromDay: number,
): EngineeringChange {
  const change = getChange(changes, changeId);
  assertStatus(change, '承認_影響分析中');
  if (effectiveFromDay === undefined || effectiveFromDay === null) {
    throw new Error('有効日（effectiveFromDay）を設定せずにECOを発行することはできません');
  }
  change.effectiveFromDay = effectiveFromDay;
  change.status = 'ECO発行';
  change.type = 'ECO';
  return change;
}

// ECO発行 -> ECN通知済
export function notifyEcn(changes: EngineeringChange[], changeId: string): EngineeringChange {
  const change = getChange(changes, changeId);
  assertStatus(change, 'ECO発行');
  change.status = 'ECN通知済';
  change.type = 'ECN';
  return change;
}

// ECN通知済 -> クローズ（UC-ECM-6: disposition「使い切り」は拒否せず警告のみ返す）。
export function closeChange(
  changes: EngineeringChange[],
  changeId: string,
): { change: EngineeringChange; warning: string | null } {
  const change = getChange(changes, changeId);
  assertStatus(change, 'ECN通知済');
  const warning = checkDispositionFeasibility(change);
  change.status = 'クローズ';
  return { change, warning };
}

// 取消（Rev.H追加）: ECO発行／ECN通知済／クローズのいずれからも、
// 対応するSyncEventが未エクスポートの場合に限り遷移できる（UC-ECM-8/9）。
export function withdrawChange(
  changes: EngineeringChange[],
  changeId: string,
  syncEvents: SyncEvent[],
): EngineeringChange {
  const change = getChange(changes, changeId);
  const withdrawableFrom: ChangeStatus[] = ['ECO発行', 'ECN通知済', 'クローズ'];
  if (!withdrawableFrom.includes(change.status)) {
    throw new Error(`変更 ${change.changeId} は現在「${change.status}」のため取り消せません`);
  }
  const { canWithdraw, reason } = checkWithdrawable(change, syncEvents);
  if (!canWithdraw) {
    throw new Error(reason ?? '取り消せません');
  }
  change.status = '取消';
  return change;
}

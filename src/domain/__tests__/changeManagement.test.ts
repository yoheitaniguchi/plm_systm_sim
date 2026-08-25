import { describe, expect, it } from 'vitest';
import {
  aggregateApprovalStatus,
  checkDispositionFeasibility,
  checkWithdrawable,
  closeChange,
  createChangeRequest,
  issueEco,
  notifyEcn,
  recordApproval,
  submitForReview,
  withdrawChange,
} from '../changeManagement';
import type { EngineeringChange, SyncEvent } from '../types';

function minorRequest(changes: EngineeringChange[] = []): EngineeringChange[] {
  createChangeRequest(changes, {
    changeId: 'ECR-1',
    reason: 'コスト削減',
    changeLevel: '軽微',
    impactedItemIds: ['FG-100'],
    impactedBomLineIds: [],
  });
  return changes;
}

function majorRequest(changes: EngineeringChange[] = []): EngineeringChange[] {
  createChangeRequest(changes, {
    changeId: 'ECR-2',
    reason: '品質・安全',
    changeLevel: '重大',
    impactedItemIds: ['FG-100'],
    impactedBomLineIds: [],
  });
  return changes;
}

describe('changeManagement domain', () => {
  // UC-ECM-1
  it('creates a new ECR with status "起票"', () => {
    const changes = minorRequest();
    expect(changes[0].status).toBe('起票');
    expect(changes[0].type).toBe('ECR');
  });

  // UC-ECM-2
  it('advances a minor change to 承認_影響分析中 once the design lead approves', () => {
    const changes = minorRequest();
    submitForReview(changes, 'ECR-1');
    recordApproval(changes, 'ECR-1', { approverRole: '設計リーダー', decision: '承認' });
    expect(changes[0].status).toBe('承認_影響分析中');
  });

  // UC-ECM-3
  it('keeps a major change in 審査中 until quality assurance and manufacturing also approve', () => {
    const changes = majorRequest();
    submitForReview(changes, 'ECR-2');
    recordApproval(changes, 'ECR-2', { approverRole: '設計リーダー', decision: '承認' });
    expect(changes[0].status).toBe('審査中');
    expect(aggregateApprovalStatus(changes[0])).toBe('審査中');
  });

  // UC-ECM-4
  it('rejects issuing an ECO without an effectiveFromDay', () => {
    const changes = minorRequest();
    submitForReview(changes, 'ECR-1');
    recordApproval(changes, 'ECR-1', { approverRole: '設計リーダー', decision: '承認' });
    expect(() => issueEco(changes, 'ECR-1', undefined as unknown as number)).toThrow();
  });

  // UC-ECM-5
  it('records the raising role for a shop-floor-initiated ECR', () => {
    const changes: EngineeringChange[] = [];
    createChangeRequest(changes, {
      changeId: 'ECR-3',
      reason: 'その他',
      changeLevel: '軽微',
      raisedByRole: '製造',
      impactedItemIds: [],
      impactedBomLineIds: [],
    });
    expect(changes[0].raisedByRole).toBe('製造');
  });

  // UC-ECM-6
  it('warns (but does not reject) closing an ECO with disposition 使い切り', () => {
    const changes = minorRequest();
    submitForReview(changes, 'ECR-1');
    recordApproval(changes, 'ECR-1', { approverRole: '設計リーダー', decision: '承認' });
    issueEco(changes, 'ECR-1', 10);
    notifyEcn(changes, 'ECR-1');
    changes[0].disposition = '使い切り';

    const { change, warning } = closeChange(changes, 'ECR-1');
    expect(change.status).toBe('クローズ');
    expect(warning).toMatch(/段階的/);
    expect(checkDispositionFeasibility(change)).not.toBeNull();
  });

  // UC-ECM-7
  it('rejects immediately once one required approver rejects a major change', () => {
    const changes = majorRequest();
    submitForReview(changes, 'ECR-2');
    recordApproval(changes, 'ECR-2', { approverRole: '品質保証', decision: '却下' });
    expect(changes[0].status).toBe('却下');
    expect(aggregateApprovalStatus(changes[0])).toBe('却下');
  });

  // UC-ECM-8
  it('allows withdrawal of a closed ECO whose SyncEvent has not been exported', () => {
    const changes = minorRequest();
    submitForReview(changes, 'ECR-1');
    recordApproval(changes, 'ECR-1', { approverRole: '設計リーダー', decision: '承認' });
    issueEco(changes, 'ECR-1', 10);
    notifyEcn(changes, 'ECR-1');
    closeChange(changes, 'ECR-1');

    withdrawChange(changes, 'ECR-1', []);
    expect(changes[0].status).toBe('取消');
  });

  // UC-ECM-9
  it('rejects withdrawal once the ECO has been exported via a SyncEvent', () => {
    const changes = minorRequest();
    submitForReview(changes, 'ECR-1');
    recordApproval(changes, 'ECR-1', { approverRole: '設計リーダー', decision: '承認' });
    issueEco(changes, 'ECR-1', 10);
    notifyEcn(changes, 'ECR-1');
    closeChange(changes, 'ECR-1');

    const syncEvents: SyncEvent[] = [{ eventId: 'SYNC-1', sourceChangeId: 'ECR-1', status: '送信済', exportedAtDay: 12 }];
    expect(checkWithdrawable(changes[0], syncEvents).canWithdraw).toBe(false);
    expect(() => withdrawChange(changes, 'ECR-1', syncEvents)).toThrow(/新しいECRとして/);
  });
});

import { useEffect, useState } from 'react';
import { aggregateApprovalStatus } from '../../domain/changeManagement';
import { checkDocumentCoverage } from '../../domain/document';
import type { AppAction, AppState } from '../../domain/reducer';
import type { ApproverDecision, ChangeReason, EngineeringChange } from '../../domain/types';
import { Banner } from '../components/Banner';

interface ChangeManagementTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
  prefillImpactedItemIds: string[] | null;
  onPrefillConsumed: () => void;
  showGuide: boolean;
  onDismissGuide: () => void;
}

const REASONS: ChangeReason[] = ['コスト削減', '品質・安全', '顧客要求', '陳腐化', '規制対応', 'その他'];
const ROLES: ApproverDecision['approverRole'][] = ['設計リーダー', '品質保証', '製造', '調達'];

export function ChangeManagementTab({
  state,
  dispatch,
  prefillImpactedItemIds,
  onPrefillConsumed,
  showGuide,
  onDismissGuide,
}: ChangeManagementTabProps) {
  const [form, setForm] = useState({
    changeId: '',
    reason: 'コスト削減' as ChangeReason,
    changeLevel: '軽微' as '軽微' | '重大',
    raisedByRole: '',
    impactedItemIds: '',
  });
  const [effectiveDay, setEffectiveDay] = useState<Record<string, string>>({});

  useEffect(() => {
    if (prefillImpactedItemIds) {
      setForm((f) => ({ ...f, impactedItemIds: prefillImpactedItemIds.join(', ') }));
      onPrefillConsumed();
    }
  }, [prefillImpactedItemIds, onPrefillConsumed]);

  const impactedIds = form.impactedItemIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const docWarnings =
    impactedIds.length > 0
      ? checkDocumentCoverage(
          {
            changeId: 'preview',
            type: 'ECR',
            status: '起票',
            reason: form.reason,
            changeLevel: form.changeLevel,
            impactedItemIds: impactedIds,
            impactedBomLineIds: [],
            approvals: [],
          },
          state.items,
        )
      : [];

  return (
    <section aria-labelledby="ecm-heading">
      <h2 id="ecm-heading">変更管理（ECR/ECO/ECN）</h2>

      {showGuide && (
        <Banner
          kind="info"
          message="起票 → 審査 → 影響分析 → ECO発行 → ECN通知 → クローズ、という一連の流れをこの画面で体験できます。"
          onDismiss={onDismissGuide}
        />
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">種別</th>
            <th scope="col">ステータス</th>
            <th scope="col">理由</th>
            <th scope="col">重大度</th>
            <th scope="col">承認状況</th>
            <th scope="col">対象品目</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {state.changes.map((change) => (
            <tr key={change.changeId}>
              <td>{change.changeId}</td>
              <td>{change.type}</td>
              <td>
                <span className="badge">{change.status}</span>
              </td>
              <td>{change.reason}</td>
              <td>{change.changeLevel}</td>
              <td>{change.status === '審査中' ? aggregateApprovalStatus(change) : '—'}</td>
              <td>{change.impactedItemIds.join(', ')}</td>
              <td className="actions-cell">
                {change.status === '起票' && (
                  <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'change/submitForReview', changeId: change.changeId })}>
                    審査へ提出
                  </button>
                )}
                {change.status === '審査中' && (
                  <div className="approval-controls">
                    {(change.changeLevel === '重大' ? ROLES.slice(0, 3) : ['設計リーダー' as const]).map((role) => (
                      <span key={role} className="approval-controls__row">
                        {role}:
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            dispatch({ type: 'change/recordApproval', changeId: change.changeId, decision: { approverRole: role, decision: '承認' } })
                          }
                        >
                          承認
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            dispatch({ type: 'change/recordApproval', changeId: change.changeId, decision: { approverRole: role, decision: '却下' } })
                          }
                        >
                          却下
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {change.status === '承認_影響分析中' && (
                  <span className="approval-controls__row">
                    <input
                      type="number"
                      placeholder="有効日(D+)"
                      value={effectiveDay[change.changeId] ?? ''}
                      onChange={(e) => setEffectiveDay({ ...effectiveDay, [change.changeId]: e.target.value })}
                    />
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        dispatch({
                          type: 'change/issueEco',
                          changeId: change.changeId,
                          effectiveFromDay: Number(effectiveDay[change.changeId] ?? NaN),
                        })
                      }
                    >
                      ECO発行
                    </button>
                  </span>
                )}
                {change.status === 'ECO発行' && (
                  <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'change/notifyEcn', changeId: change.changeId })}>
                    ECN通知
                  </button>
                )}
                {change.status === 'ECN通知済' && (
                  <button type="button" className="primary-button" onClick={() => dispatch({ type: 'change/close', changeId: change.changeId })}>
                    クローズ
                  </button>
                )}
                {(change.status === 'ECO発行' || change.status === 'ECN通知済' || change.status === 'クローズ') && (
                  <button type="button" className="danger-button" onClick={() => dispatch({ type: 'change/withdraw', changeId: change.changeId })}>
                    取消
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>新規ECRを起票（UC-ECM-1）</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: 'change/create',
            input: {
              changeId: form.changeId,
              reason: form.reason,
              changeLevel: form.changeLevel,
              raisedByRole: (form.raisedByRole || undefined) as EngineeringChange['raisedByRole'],
              impactedItemIds: impactedIds,
              impactedBomLineIds: [],
            },
          });
          setForm({ changeId: '', reason: 'コスト削減', changeLevel: '軽微', raisedByRole: '', impactedItemIds: '' });
        }}
      >
        <label>
          変更ID
          <input required value={form.changeId} onChange={(e) => setForm({ ...form, changeId: e.target.value })} />
        </label>
        <label>
          理由（統制語彙）
          <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as ChangeReason })}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          重大度
          <select value={form.changeLevel} onChange={(e) => setForm({ ...form, changeLevel: e.target.value as '軽微' | '重大' })}>
            <option value="軽微">軽微</option>
            <option value="重大">重大</option>
          </select>
        </label>
        <label>
          起票元（現場フィードバック時に指定、UC-ECM-5）
          <select value={form.raisedByRole} onChange={(e) => setForm({ ...form, raisedByRole: e.target.value })}>
            <option value="">（設計主導）</option>
            <option value="設計">設計</option>
            <option value="品質保証">品質保証</option>
            <option value="製造">製造</option>
            <option value="調達">調達</option>
          </select>
        </label>
        <label>
          対象品目（カンマ区切り）
          <input value={form.impactedItemIds} onChange={(e) => setForm({ ...form, impactedItemIds: e.target.value })} />
        </label>
        <button type="submit" className="primary-button">
          起票する
        </button>
      </form>
      {docWarnings.length > 0 && (
        <div className="banner banner--warning" role="status">
          {docWarnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
    </section>
  );
}

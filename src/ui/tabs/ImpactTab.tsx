import { useState } from 'react';
import { currentEbomLines } from '../../domain/ebom';
import { computeCostImpact, whereUsed } from '../../domain/impactAnalysis';
import { currentMbomLines, resolveAlternates } from '../../domain/mbom';
import { effectiveMbomLines } from '../../domain/reducer';
import type { AppAction, AppState } from '../../domain/reducer';
import type { BomType, EngineeringChange } from '../../domain/types';
import { formatYen } from '../format';

interface ImpactTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
  onRequestEcr: (impactedItemIds: string[]) => void;
}

export function ImpactTab({ state, onRequestEcr }: ImpactTabProps) {
  const [itemId, setItemId] = useState('');
  const [bomType, setBomType] = useState<BomType>('M');
  const [result, setResult] = useState<{ parentItemId: string; depth: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState('');
  const [confirmedChangeId, setConfirmedChangeId] = useState('');

  const lines = bomType === 'E' ? currentEbomLines(state.bomLines) : currentMbomLines(state.bomLines);
  const impactedItemIds = result ? [...new Set(result.map((r) => r.parentItemId))] : [];

  const defaultMbom = resolveAlternates(currentMbomLines(state.bomLines), {});
  const overriddenMbom = effectiveMbomLines(state);
  const alternateRoots = [...new Set(overriddenMbom.map((l) => l.parentItemId))].filter(
    (id) => !overriddenMbom.some((l) => l.childItemId === id),
  );
  const dummyChange: EngineeringChange = {
    changeId: 'preview',
    type: 'ECR',
    status: '起票',
    reason: 'コスト削減',
    changeLevel: '軽微',
    impactedItemIds: alternateRoots,
    impactedBomLineIds: [],
    approvals: [],
  };
  const costImpact = computeCostImpact(dummyChange, defaultMbom, overriddenMbom, state.items);

  const changesWithSnapshot = state.changes.filter(
    (c) => c.beforeBomLines !== undefined && c.impactedItemIds.length > 0,
  );
  const confirmedChange = changesWithSnapshot.find((c) => c.changeId === confirmedChangeId) ?? null;
  const changeCostImpact = confirmedChange
    ? computeCostImpact(confirmedChange, confirmedChange.beforeBomLines ?? [], overriddenMbom, state.items)
    : [];

  return (
    <section aria-labelledby="impact-heading">
      <h2 id="impact-heading">影響分析（BOM逆展開）</h2>
      <p className="muted">
        影響分析はBOM次元のみを扱います。在庫影響は疎結合連携では原理的に把握できず、サプライヤ・原価影響は意図的にスコープを絞っています（7.1）。
      </p>

      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          try {
            setResult(whereUsed(itemId, lines, bomType, state.currentDay));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setResult(null);
          }
        }}
      >
        <label>
          対象品目
          <select required value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="" disabled>
              選択してください
            </option>
            {state.items.map((i) => (
              <option key={i.itemId} value={i.itemId}>
                {i.itemId}（{i.name}）
              </option>
            ))}
          </select>
        </label>
        <label>
          BOM種別
          <select value={bomType} onChange={(e) => setBomType(e.target.value as BomType)}>
            <option value="E">E-BOM</option>
            <option value="M">M-BOM</option>
          </select>
        </label>
        <button type="submit" className="primary-button">
          どこで使われているか調べる（whereUsed）
        </button>
      </form>

      {error && <div className="banner banner--error" role="alert">{error}</div>}

      {result && (
        <>
          <h3>影響を受ける品目（UC-IMPACT-1/3）</h3>
          <ul className="plain-list">
            {result.map((r) => (
              <li key={`${r.parentItemId}-${r.depth}`}>
                深さ{r.depth}: {r.parentItemId}
              </li>
            ))}
          </ul>
          {impactedItemIds.length > 0 && (
            <button type="button" className="secondary-button" onClick={() => onRequestEcr(impactedItemIds)}>
              この結果でECRを起票する
            </button>
          )}
        </>
      )}

      <h3>原価影響の簡易算出（7.7）</h3>
      <p className="muted">M-BOMタブで代替部品を切り替えた場合の、購入部品費用の積み上げ差分です。</p>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">品目</th>
            <th scope="col">変更前</th>
            <th scope="col">変更後</th>
            <th scope="col">差分</th>
          </tr>
        </thead>
        <tbody>
          {costImpact.map((c) => (
            <tr key={c.itemId}>
              <td>{c.itemId}</td>
              <td>{formatYen(c.before)}</td>
              <td>{formatYen(c.after)}</td>
              <td className={c.delta < 0 ? 'delta-negative' : c.delta > 0 ? 'delta-positive' : ''}>{formatYen(c.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>ECRごとの原価影響（起票時点比較）</h3>
      <p className="muted">
        ECR起票時点に記録したM-BOMスナップショットと現在のM-BOMを比較します。ECOクローズ後に、
        起票時点からどれだけ原価が変わったかを確認する用途を想定しています。
      </p>
      {changesWithSnapshot.length === 0 ? (
        <p className="muted">
          起票時点のBOMスナップショットを持つ変更がまだありません。変更管理タブでECRを起票すると、この一覧から選べるようになります。
        </p>
      ) : (
        <>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmedChangeId(selectedChangeId);
            }}
          >
            <label>
              対象の変更
              <select required value={selectedChangeId} onChange={(e) => setSelectedChangeId(e.target.value)}>
                <option value="" disabled>
                  選択してください
                </option>
                {changesWithSnapshot.map((c) => (
                  <option key={c.changeId} value={c.changeId}>
                    {c.changeId}（{c.status}）
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-button">
              原価影響を表示する
            </button>
          </form>
          {confirmedChange && (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">品目</th>
                  <th scope="col">起票時点</th>
                  <th scope="col">現在</th>
                  <th scope="col">差分</th>
                </tr>
              </thead>
              <tbody>
                {changeCostImpact.map((c) => (
                  <tr key={c.itemId}>
                    <td>{c.itemId}</td>
                    <td>{formatYen(c.before)}</td>
                    <td>{formatYen(c.after)}</td>
                    <td className={c.delta < 0 ? 'delta-negative' : c.delta > 0 ? 'delta-positive' : ''}>{formatYen(c.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

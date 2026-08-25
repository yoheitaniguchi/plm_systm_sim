import { useState } from 'react';
import { explodePlanningBom } from '../../domain/planningBom';
import type { PlanningExplosionLine } from '../../domain/planningBom';
import type { AppState } from '../../domain/reducer';
import { formatDay } from '../format';

interface PlanningBomTabProps {
  state: AppState;
}

export function PlanningBomTab({ state }: PlanningBomTabProps) {
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);
  const [targetNeedDay, setTargetNeedDay] = useState(state.currentDay + 30);
  const [asOfDay, setAsOfDay] = useState(state.currentDay);
  const [result, setResult] = useState<PlanningExplosionLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="planning-bom-heading">
      <h2 id="planning-bom-heading">計画BOM（時系列BOM展開）</h2>
      <p className="muted">
        確定済みM-BOMを対象に、リードタイムを考慮した時系列の所要展開（何をいつまでに用意すべきか）を算出します。単一品目・単一数量のWhat-if展開です。
        production_system_sim側の計画オーダ（トランザクション）連携は対象外です（1.2）。
      </p>

      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          try {
            setResult(
              explodePlanningBom(itemId, qty, targetNeedDay, asOfDay, state.bomLines, state.items, state.alternateOverrides),
            );
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
          数量
          <input type="number" min={1} required value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </label>
        <label>
          目標完成日（D+）
          <input type="number" required value={targetNeedDay} onChange={(e) => setTargetNeedDay(Number(e.target.value))} />
        </label>
        <label>
          基準日（asOfDay、D+）
          <input type="number" required value={asOfDay} onChange={(e) => setAsOfDay(Number(e.target.value))} />
        </label>
        <button type="submit" className="primary-button">
          展開する
        </button>
      </form>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">階層</th>
              <th scope="col">品目</th>
              <th scope="col">親品目</th>
              <th scope="col">必要数</th>
              <th scope="col">リードタイム</th>
              <th scope="col">必要日</th>
              <th scope="col">着手/発注日</th>
            </tr>
          </thead>
          <tbody>
            {result.map((r, idx) => (
              <tr key={`${r.itemId}-${r.parentItemId}-${idx}`}>
                <td>{r.level}</td>
                <td>{r.itemId}</td>
                <td>{r.parentItemId || '—'}</td>
                <td>{r.qtyRequired}</td>
                <td>{r.leadTimeDays}日</td>
                <td>{formatDay(r.needByDay)}</td>
                <td>{formatDay(r.startByDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

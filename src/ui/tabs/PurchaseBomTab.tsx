import { useState } from 'react';
import { buildPurchaseBom, summarizePurchaseBomBySupplier } from '../../domain/impactAnalysis';
import type { PurchaseBomLine } from '../../domain/impactAnalysis';
import { effectiveMbomLines } from '../../domain/reducer';
import type { AppState } from '../../domain/reducer';
import { formatYen } from '../format';

interface PurchaseBomTabProps {
  state: AppState;
}

export function PurchaseBomTab({ state }: PurchaseBomTabProps) {
  const [itemId, setItemId] = useState('');
  const [asOfDay, setAsOfDay] = useState(state.currentDay);
  const [result, setResult] = useState<PurchaseBomLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missingSupplierIds = result?.filter((r) => r.supplierMissing).map((r) => r.itemId) ?? [];
  const supplierSummary = result ? summarizePurchaseBomBySupplier(result) : [];

  return (
    <section aria-labelledby="purchase-bom-heading">
      <h2 id="purchase-bom-heading">発注BOM（購買ビュー）</h2>
      <p className="muted">
        M-BOMをBUY品目（購入品）まで展開し、仕入先・単価・リードタイムを集計する読み取り専用ビューです。発注書の起票・受入検査等のサプライヤ側プロセスは対象外です（1.3・11章）。
      </p>

      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          try {
            setResult(buildPurchaseBom(itemId, effectiveMbomLines(state), state.items, asOfDay));
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
          基準日（asOfDay、D+）
          <input type="number" required value={asOfDay} onChange={(e) => setAsOfDay(Number(e.target.value))} />
        </label>
        <button type="submit" className="primary-button">
          発注BOMを展開する
        </button>
      </form>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <>
          {missingSupplierIds.length > 0 && (
            <div className="banner banner--warning" role="status">
              既定仕入先が未設定です（UC-SYNC-6でエクスポート時に拒否されます）: {missingSupplierIds.join('、')}
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">品目</th>
                <th scope="col">数量</th>
                <th scope="col">仕入先</th>
                <th scope="col">単価</th>
                <th scope="col">拡張原価</th>
                <th scope="col">リードタイム</th>
              </tr>
            </thead>
            <tbody>
              {result.map((r) => (
                <tr key={r.itemId}>
                  <td>
                    {r.itemId}（{r.name}）
                  </td>
                  <td>{r.totalQtyPer}</td>
                  <td>
                    {r.defaultSupplierId ?? '—'}
                    {r.supplierMissing && <span className="badge badge--warning">未設定</span>}
                  </td>
                  <td>{formatYen(r.purchasePrice)}</td>
                  <td>{formatYen(r.extendedCost)}</td>
                  <td>{r.leadTimeDays}日</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>仕入先別集計</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">仕入先</th>
                <th scope="col">数量合計</th>
                <th scope="col">拡張原価合計</th>
              </tr>
            </thead>
            <tbody>
              {supplierSummary.map((s) => (
                <tr key={s.supplierId}>
                  <td>{s.supplierId}</td>
                  <td>{s.totalQty}</td>
                  <td>{formatYen(s.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { nextLifecycleStatus } from '../../domain/item';
import type { AppAction, AppState } from '../../domain/reducer';
import type { MakeBuy } from '../../domain/types';
import { formatYen } from '../format';

interface ItemsTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

export function ItemsTab({ state, dispatch }: ItemsTabProps) {
  const [form, setForm] = useState({
    itemId: '',
    name: '',
    makeBuy: 'MAKE' as MakeBuy,
    leadTimeDays: 1,
    defaultSupplierId: '',
    purchasePrice: '',
    salesPrice: '',
  });

  return (
    <section aria-labelledby="items-heading">
      <h2 id="items-heading">品目マスタ</h2>
      <p className="muted">品目コードは登録後に変更できません（改名は削除して再登録してください、UC-ITEM-4）。</p>

      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">品目コード</th>
            <th scope="col">名称</th>
            <th scope="col">MAKE/BUY</th>
            <th scope="col">LT(日)</th>
            <th scope="col">単価</th>
            <th scope="col">ライフサイクル</th>
            <th scope="col">図面</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {state.items.map((item) => {
            const next = nextLifecycleStatus(item.lifecycleStatus);
            return (
              <tr key={item.itemId}>
                <td>{item.itemId}</td>
                <td>{item.name}</td>
                <td>{item.makeBuy}</td>
                <td>{item.leadTimeDays}</td>
                <td>{formatYen(item.makeBuy === 'BUY' ? item.purchasePrice : item.salesPrice)}</td>
                <td>
                  <span className="badge">{item.lifecycleStatus}</span>
                </td>
                <td>{item.drawingRef ?? '—'}</td>
                <td>
                  {next && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => dispatch({ type: 'item/advanceLifecycle', itemId: item.itemId, to: next })}
                    >
                      {next}へ進める
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>新規品目を登録（UC-ITEM-1）</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: 'item/create',
            input: {
              itemId: form.itemId,
              name: form.name,
              makeBuy: form.makeBuy,
              leadTimeDays: Number(form.leadTimeDays),
              defaultSupplierId: form.defaultSupplierId || undefined,
              purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : undefined,
              salesPrice: form.salesPrice ? Number(form.salesPrice) : undefined,
            },
          });
          setForm({ itemId: '', name: '', makeBuy: 'MAKE', leadTimeDays: 1, defaultSupplierId: '', purchasePrice: '', salesPrice: '' });
        }}
      >
        <label>
          品目コード
          <input required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} />
        </label>
        <label>
          名称
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          MAKE/BUY
          <select value={form.makeBuy} onChange={(e) => setForm({ ...form, makeBuy: e.target.value as MakeBuy })}>
            <option value="MAKE">MAKE</option>
            <option value="BUY">BUY</option>
          </select>
        </label>
        <label>
          リードタイム(日)
          <input
            type="number"
            min={0}
            required
            value={form.leadTimeDays}
            onChange={(e) => setForm({ ...form, leadTimeDays: Number(e.target.value) })}
          />
        </label>
        {form.makeBuy === 'BUY' && (
          <>
            <label>
              既定仕入先ID
              <input value={form.defaultSupplierId} onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })} />
            </label>
            <label>
              購入単価
              <input value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
            </label>
          </>
        )}
        {form.makeBuy === 'MAKE' && (
          <label>
            売価
            <input value={form.salesPrice} onChange={(e) => setForm({ ...form, salesPrice: e.target.value })} />
          </label>
        )}
        <button type="submit" className="primary-button">
          登録する
        </button>
      </form>
    </section>
  );
}

import { useState } from 'react';
import { currentOperations } from '../../domain/operation';
import type { AppAction, AppState } from '../../domain/reducer';
import { RESOURCE_KINDS, summarizeResourceUsage } from '../../domain/resource';
import type { OperationResource, ResourceKind } from '../../domain/types';

interface ResourceTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

interface ResourceForm {
  opKey: string; // `${itemId}::${opCode}`
  kind: ResourceKind;
  code: string;
  name: string;
  basis: 'qty' | 'time';
  amount: number;
}

const EMPTY_FORM: ResourceForm = { opKey: '', kind: '設備', code: '', name: '', basis: 'qty', amount: 1 };

function amountLabel(r: { requiredQty?: number; requiredTimeMin?: number }): string {
  return r.requiredQty !== undefined ? `必要数 ${r.requiredQty}` : `必要時間 ${r.requiredTimeMin}分`;
}

// 資源（BOR）タブ（design.md PLM-EXT-19）。工程ごとの設備・治具工具・作業者スキルの追加・削除と、
// 全工程を横断した「どの資源がどの工程で要るか」の一覧。
export function ResourceTab({ state, dispatch }: ResourceTabProps) {
  const operations = currentOperations(state.operations);
  const resources = state.operationResources;
  const usage = summarizeResourceUsage(resources);
  const [form, setForm] = useState<ResourceForm>(EMPTY_FORM);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const itemName = (id: string) => state.items.find((i) => i.itemId === id)?.name ?? id;
  const opLabel = (itemId: string, opCode: string) => {
    const op = operations.find((o) => o.itemId === itemId && o.opCode === opCode);
    return `${itemName(itemId)}（${itemId}） ${opCode}${op ? ` ${op.name}` : '（終了した工程）'}`;
  };
  const opKeys = operations.map((o) => `${o.itemId}::${o.opCode}`);
  const opKey = opKeys.includes(form.opKey) ? form.opKey : (opKeys[0] ?? '');
  const removing: OperationResource | undefined = resources.find((r) => r.resourceId === removingId);

  return (
    <section aria-labelledby="resource-heading">
      <h2 id="resource-heading">資源（BOR）</h2>
      <p className="muted">工程ごとに必要な設備・治具工具・作業者スキルを定義します。原価や能力の計算には使いません。</p>
      <div className="banner banner--info">
        資源・工程の名称・作業内容・投入工程は MasterSnapshot に書き出されません（PLM側のみの情報です）。MasterSnapshot
        を取り込み直すと、資源は消えます。
      </div>

      <h3 id="resource-list-heading">工程ごとの資源</h3>
      {resources.length === 0 ? (
        <p>資源がまだありません。下の「資源を追加」から登録してください。</p>
      ) : (
        <table className="data-table" aria-labelledby="resource-list-heading">
          <thead>
            <tr>
              <th scope="col">工程</th>
              <th scope="col">種別</th>
              <th scope="col">コード</th>
              <th scope="col">名称</th>
              <th scope="col">必要数・必要時間</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {operations.flatMap((o) =>
              resources
                .filter((r) => r.itemId === o.itemId && r.opCode === o.opCode)
                .map((r) => (
                  <tr key={r.resourceId}>
                    <td>{opLabel(r.itemId, r.opCode)}</td>
                    <td>{r.kind}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{amountLabel(r)}</td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={`${r.opCode}の${r.kind} ${r.code}を削除`}
                        onClick={() => setRemovingId(r.resourceId)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      )}

      {removing && (
        <div className="banner banner--warning">
          <p>
            {opLabel(removing.itemId, removing.opCode)}の{removing.kind}「{removing.code} {removing.name}」を削除します。資源は版で管理しないため、履歴は残りません。
          </p>
          <div className="actions-cell">
            <button type="button" className="secondary-button" autoFocus onClick={() => setRemovingId(null)}>
              削除をやめる
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                dispatch({ type: 'resource/remove', resourceId: removing.resourceId });
                setRemovingId(null);
              }}
            >
              {removing.code}の削除を確定
            </button>
          </div>
        </div>
      )}

      <h3 id="resource-add-heading">資源を追加</h3>
      {operations.length === 0 ? (
        <p>工程がありません。先に「工程（BOP）」タブで工程を登録してください。</p>
      ) : (
        <form
          aria-labelledby="resource-add-heading"
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const [itemId, opCode] = opKey.split('::');
            dispatch({
              type: 'resource/add',
              input: {
                itemId,
                opCode,
                kind: form.kind,
                code: form.code,
                name: form.name,
                ...(form.basis === 'qty' ? { requiredQty: form.amount } : { requiredTimeMin: form.amount }),
              },
            });
            // 同じ工程に続けて登録しやすいよう、工程と種別は残す
            setForm({ ...form, opKey, code: '', name: '' });
          }}
        >
          <label>
            工程
            <select value={opKey} onChange={(e) => setForm({ ...form, opKey: e.target.value })}>
              {operations.map((o) => (
                <option key={`${o.itemId}::${o.opCode}`} value={`${o.itemId}::${o.opCode}`}>
                  {opLabel(o.itemId, o.opCode)}
                </option>
              ))}
            </select>
          </label>
          <label>
            種別
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ResourceKind })}>
              {RESOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            コード
            <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
          <label>
            名称
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            指定のしかた（どちらか一方）
            <select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as ResourceForm['basis'] })}>
              <option value="qty">必要数</option>
              <option value="time">必要時間（分）</option>
            </select>
          </label>
          <label>
            {form.basis === 'qty' ? '必要数' : '必要時間（分）'}
            <input
              type="number"
              min={0.01}
              step="any"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
          </label>
          <button type="submit" className="primary-button">
            資源を追加
          </button>
        </form>
      )}

      <h3 id="resource-usage-heading">資源の横断一覧（どの資源がどの工程で要るか）</h3>
      {usage.length === 0 ? (
        <p>資源がまだありません。</p>
      ) : (
        <table className="data-table" aria-labelledby="resource-usage-heading">
          <thead>
            <tr>
              <th scope="col">種別</th>
              <th scope="col">コード</th>
              <th scope="col">名称</th>
              <th scope="col">使う工程</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={`${u.kind}::${u.code}`}>
                <td>{u.kind}</td>
                <td>{u.code}</td>
                <td>
                  {u.names.join(' ／ ')}
                  {u.names.length > 1 && <span className="badge badge--warning">名称が揃っていません</span>}
                </td>
                <td>
                  <ul className="plain-list">
                    {u.usedBy.map((use) => (
                      <li key={`${use.itemId}::${use.opCode}`}>
                        {opLabel(use.itemId, use.opCode)}（{amountLabel(use)}）
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

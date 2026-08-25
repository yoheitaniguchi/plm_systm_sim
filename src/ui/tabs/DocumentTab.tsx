import { useState } from 'react';
import { getDocumentHistory } from '../../domain/document';
import type { AppAction, AppState } from '../../domain/reducer';

interface DocumentTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

const knownDocIds = (state: AppState) => [...new Set(state.documents.map((d) => d.docId))];

export function DocumentTab({ state, dispatch }: DocumentTabProps) {
  const [form, setForm] = useState({ docId: '', relatedItemId: '', docType: '図面' as '図面' | '仕様書' });

  return (
    <section aria-labelledby="doc-heading">
      <h2 id="doc-heading">文書・版数</h2>

      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">文書コード</th>
            <th scope="col">最新版</th>
            <th scope="col">対象品目</th>
            <th scope="col">種別</th>
            <th scope="col">履歴</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {knownDocIds(state).map((docId) => {
            const history = getDocumentHistory(state.documents, docId);
            const latest = history.at(-1)!;
            return (
              <tr key={docId}>
                <td>{docId}</td>
                <td>v{latest.version}</td>
                <td>{latest.relatedItemId}</td>
                <td>{latest.docType}</td>
                <td>{history.map((d) => `v${d.version}`).join(', ')}</td>
                <td>
                  <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'document/revise', docId })}>
                    改訂する
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>図面・仕様書を登録（UC-DOC-1）</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({ type: 'document/register', input: form });
          setForm({ docId: '', relatedItemId: '', docType: '図面' });
        }}
      >
        <label>
          文書コード
          <input required value={form.docId} onChange={(e) => setForm({ ...form, docId: e.target.value })} />
        </label>
        <label>
          対象品目
          <select required value={form.relatedItemId} onChange={(e) => setForm({ ...form, relatedItemId: e.target.value })}>
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
          種別
          <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value as '図面' | '仕様書' })}>
            <option value="図面">図面</option>
            <option value="仕様書">仕様書</option>
          </select>
        </label>
        <button type="submit" className="primary-button">
          登録する
        </button>
      </form>
    </section>
  );
}

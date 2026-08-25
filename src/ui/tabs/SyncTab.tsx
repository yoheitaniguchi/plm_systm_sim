import { useState } from 'react';
import { bicycleMasterSnapshot, woodenChairMasterSnapshot } from '../../domain/presets';
import type { AppAction, AppState } from '../../domain/reducer';
import { Banner } from '../components/Banner';

interface SyncTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

export function SyncTab({ state, dispatch }: SyncTabProps) {
  const [importText, setImportText] = useState('');
  const [currentText, setCurrentText] = useState('');
  const [closedChangeId, setClosedChangeId] = useState('');

  function downloadMergedSnapshot() {
    const merged = state.exportPreflight?.mergedSnapshot;
    if (!merged) return;
    const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MasterSnapshot.updated.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="sync-heading">
      <h2 id="sync-heading">マスタ連携（Sync）</h2>
      <p className="muted">
        production_system_simとはJSONファイルの手動受け渡しで連携します（疎結合）。インポートするとproduction_system_sim側の
        <strong>受注・計画オーダ・製造・購買・在庫・出荷の全トランザクションがリセットされる</strong>ため、新しいセッションを始めるタイミングで行うのが自然です（9.4）。
      </p>

      <h3>1. MasterSnapshotをインポート（UC-SYNC-1）</h3>
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={() => setImportText(JSON.stringify(woodenChairMasterSnapshot, null, 2))}>
          木製イスのサンプルを読み込む
        </button>
        <button type="button" className="secondary-button" onClick={() => setImportText(JSON.stringify(bicycleMasterSnapshot, null, 2))}>
          自転車のサンプルを読み込む（応用）
        </button>
      </div>
      <textarea
        rows={6}
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder="production_system_simから書き出したMasterSnapshot JSONを貼り付け"
      />
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          try {
            dispatch({ type: 'sync/import', json: JSON.parse(importText), importedAtDay: state.currentDay });
          } catch {
            dispatch({ type: 'sync/import', json: null, importedAtDay: state.currentDay });
          }
        }}
      >
        インポートする
      </button>

      <h3>2. エクスポート前の「現状確認」（9.6・7.4）</h3>
      <p className="muted">production_system_sim側の最新MasterSnapshotを再取得し、貼り付けてください。競合検知を行います。</p>
      <textarea rows={6} value={currentText} onChange={(e) => setCurrentText(e.target.value)} placeholder="現状確認用のMasterSnapshot JSON" />
      <button
        type="button"
        className="primary-button"
        disabled={!state.syncSession}
        onClick={() => {
          try {
            dispatch({ type: 'sync/preflight', currentJson: JSON.parse(currentText) });
          } catch {
            dispatch({ type: 'sync/preflight', currentJson: null });
          }
        }}
      >
        現状確認を実行
      </button>

      {state.exportPreflight && (
        <div className="tree-card">
          <h4>結果: {state.exportPreflight.status}</h4>
          {state.exportPreflight.autoMergedNotes?.map((note) => (
            <div key={note} className="banner banner--info">
              {note}
            </div>
          ))}
          {state.exportPreflight.status === 'conflict' && (
            <>
              <Banner kind="error" message="競合が見つかりました。解決するまでエクスポートできません（UC-SYNC-8）。" />
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">種別</th>
                    <th scope="col">キー</th>
                    <th scope="col">PLM側（ours）</th>
                    <th scope="col">production_system_sim側（theirs）</th>
                    <th scope="col">解決</th>
                  </tr>
                </thead>
                <tbody>
                  {state.exportPreflight.conflicts?.map((c) => (
                    <tr key={`${c.kind}-${c.key}`}>
                      <td>{c.kind}</td>
                      <td>{c.key}</td>
                      <td>
                        <pre>{JSON.stringify(c.ours)}</pre>
                      </td>
                      <td>
                        <pre>{JSON.stringify(c.theirs)}</pre>
                      </td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => dispatch({ type: 'sync/resolveConflict', kind: c.kind === 'passthrough' ? 'item' : c.kind, key: c.key, resolution: 'ours' })}
                        >
                          PLM側を採用
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => dispatch({ type: 'sync/resolveConflict', kind: c.kind === 'passthrough' ? 'item' : c.kind, key: c.key, resolution: 'theirs' })}
                        >
                          相手側を採用
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {state.exportPreflight.status !== 'conflict' && (
            <>
              <label>
                このエクスポートの元になったECO/ECN ID
                <input value={closedChangeId} onChange={(e) => setClosedChangeId(e.target.value)} />
              </label>
              <div className="button-row">
                <button type="button" className="primary-button" onClick={downloadMergedSnapshot}>
                  MasterSnapshot.jsonをダウンロード
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => dispatch({ type: 'sync/confirmExport', sourceChangeId: closedChangeId })}
                >
                  エクスポート確定（新しいベースラインにする）
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <h3>3. エクスポート履歴</h3>
      <ul className="plain-list">
        {state.syncEvents.map((e) => (
          <li key={e.eventId}>
            {e.eventId}: {e.sourceChangeId} を D+{e.exportedAtDay} に送信済
          </li>
        ))}
      </ul>
    </section>
  );
}

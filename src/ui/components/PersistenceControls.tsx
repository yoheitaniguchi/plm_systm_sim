// ヘッダーの保存メニューと、保存に関するお知らせ（design.md PLM-EXT-25）。
import { useState } from 'react';
import { discardBrokenData, readBrokenData, type BootResult, type KeyValueStorage } from '../../domain/persistence';
import type { Persistence } from '../usePersistence';

const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP');

export function PersistenceMenu({ persistence }: { persistence: Persistence }) {
  const [confirming, setConfirming] = useState(false);
  const { enabled, available, lastSavedAt, saveError } = persistence;
  const status = !available
    ? 'このブラウザでは保存できません（リロードで消えます）'
    : !enabled
      ? '保存しない（リロードで消えます）'
      : saveError
        ? '保存を止めています（リロードで消えます）'
        : lastSavedAt
          ? `このブラウザに保存中（最終 ${time(lastSavedAt)}）`
          : 'このブラウザに保存中';

  return (
    <div className="app-header__persistence" role="group" aria-label="保存">
      <span role="status">{status}</span>
      {available && (
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => persistence.setEnabled(e.target.checked)} />
          このブラウザに保存する
        </label>
      )}
      {available &&
        (confirming ? (
          <span className="app-header__confirm">
            保存したデータを消して、木製イスのサンプルで始め直します。今の内容は戻せません。
            <button type="button" className="danger-button" onClick={persistence.restartWithSample}>
              消して始め直す
            </button>
            <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>
              やめる
            </button>
          </span>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>
            保存を消してサンプルで始め直す
          </button>
        ))}
    </div>
  );
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 起動時の結果（壊れたデータ・使えない保存領域）と、保存中のお知らせ（書けない・別のタブで保存された）
export function PersistenceNotices({
  boot,
  storage,
  persistence,
}: {
  boot: BootResult;
  storage: KeyValueStorage | null;
  persistence: Persistence;
}) {
  const [broken, setBroken] = useState(() => (boot.kind === 'broken' ? readBrokenData(storage) : null));
  const [unavailableShown, setUnavailableShown] = useState(boot.kind === 'unavailable');

  return (
    <>
      {boot.kind === 'broken' && (
        <div className="banner banner--warning" role="alert">
          <p>
            保存したデータを読み込めなかったため、木製イスのサンプルで起動しました。理由：{boot.reason}
          </p>
          {broken !== null && storage && (
            <p>
              読めなかったデータは別の場所に退避してあります。
              <button type="button" className="secondary-button" onClick={() => downloadText(broken, 'plm-systm-sim-broken.json')}>
                退避したデータを書き出す
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  discardBrokenData(storage);
                  setBroken(null);
                }}
              >
                退避したデータを捨てる
              </button>
            </p>
          )}
        </div>
      )}
      {unavailableShown && boot.kind === 'unavailable' && (
        <div className="banner banner--info" role="status">
          {boot.reason}。リロードすると内容は消えます。
          <button type="button" className="banner__dismiss" aria-label="閉じる" onClick={() => setUnavailableShown(false)}>
            ×
          </button>
        </div>
      )}
      {persistence.saveError && (
        <div className="banner banner--warning" role="alert">
          {persistence.saveError}
        </div>
      )}
      {persistence.otherTabSaved && persistence.enabled && (
        <div className="banner banner--warning" role="alert">
          別のタブでこのシミュレーターの状態が保存されました。このタブで操作を続けると、別のタブの内容を上書きします（後から保存したほうが残ります）。
          <button type="button" className="secondary-button" onClick={persistence.reloadFromOtherTab}>
            別のタブの内容を読み込む（このタブの変更は捨てる）
          </button>
        </div>
      )}
    </>
  );
}

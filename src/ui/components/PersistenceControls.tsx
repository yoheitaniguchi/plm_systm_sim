// ヘッダーの保存メニューと、保存に関するお知らせ（design.md PLM-EXT-25）。
import { useEffect, useRef, useState } from 'react';
import { discardBrokenData, readBrokenData, type BootResult, type KeyValueStorage } from '../../domain/persistence';
import type { Persistence } from '../usePersistence';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

export function PersistenceMenu({ persistence }: { persistence: Persistence }) {
  const [confirming, setConfirming] = useState(false);
  const restartButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const { enabled, available, lastSavedAt, saveError } = persistence;

  // 確認を「やめる」で閉じたら、元のボタンへフォーカスを戻す
  useEffect(() => {
    if (!confirming && returnFocus.current) {
      returnFocus.current = false;
      restartButton.current?.focus();
    }
  }, [confirming]);

  // 読み上げは状態の種類が変わったときだけ（時刻は live 領域の外に出す）
  const status = !available
    ? 'このブラウザでは保存できません（リロードで消えます）'
    : !enabled
      ? '保存しない（リロードで消えます）'
      : saveError
        ? '保存を止めています（リロードすると、最後に保存できた時点に戻ります）'
        : 'このブラウザに保存中';

  return (
    <div className="app-header__persistence" role="group" aria-label="保存">
      <span>
        <span role="status">{status}</span>
        {enabled && !saveError && lastSavedAt && <span>（最終 {hhmm(lastSavedAt)}）</span>}
      </span>
      {available && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={enabled}
              aria-describedby="persistence-toggle-note"
              onChange={(e) => persistence.setEnabled(e.target.checked)}
            />
            このブラウザに保存する
          </label>
          <span id="persistence-toggle-note" className="app-header__subtitle">
            外すと、このブラウザに保存した内容を消します（画面の内容はリロードするまで残り、もう一度入れると保存し直します）
          </span>
        </>
      )}
      {available && !confirming && (
        <button ref={restartButton} type="button" className="secondary-button" onClick={() => setConfirming(true)}>
          保存を消してサンプルで始め直す
        </button>
      )}
      {available && confirming && (
        <div className="banner banner--warning banner--inline" role="group" aria-describedby="restart-confirm-note">
          <span id="restart-confirm-note">保存したデータと今の内容を消して、木製イスのサンプルで始め直します。元には戻せません。</span>
          <span className="banner__actions">
            <button
              type="button"
              className="secondary-button"
              autoFocus
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
              }}
            >
              やめる
            </button>
            <button type="button" className="danger-button" onClick={persistence.restartWithSample}>
              消して始め直す
            </button>
          </span>
        </div>
      )}
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

// 退避したデータ（読み込めなかった保存データ）。退避がある限り、起動のたびに出す
function BrokenDataNotice({ boot, storage }: { boot: BootResult; storage: KeyValueStorage }) {
  const [broken, setBroken] = useState(() => readBrokenData(storage));
  const [confirming, setConfirming] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [closed, setClosed] = useState(false);
  if (closed || (broken === null && !discarded && boot.kind !== 'broken')) return null;

  return (
    <div className="banner banner--warning banner--stack" role="status">
      {boot.kind === 'broken' && <p>保存したデータを読み込めなかったため、木製イスのサンプルで起動しました。理由：{boot.reason}</p>}
      {broken !== null && !confirming && (
        <p className="banner__actions">
          読み込めなかったデータを別の場所に退避してあります。
          <button type="button" className="secondary-button" onClick={() => downloadText(broken, 'plm-systm-sim-broken.json')}>
            退避したデータを書き出す
          </button>
          <button type="button" className="danger-button" onClick={() => setConfirming(true)}>
            退避したデータを捨てる
          </button>
        </p>
      )}
      {broken !== null && confirming && (
        <div className="banner__actions" role="group" aria-describedby="discard-broken-note">
          <span id="discard-broken-note">退避したデータを捨てます。書き出していなければ戻せません。</span>
          <button type="button" className="secondary-button" autoFocus onClick={() => setConfirming(false)}>
            やめる
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              discardBrokenData(storage);
              setBroken(null);
              setConfirming(false);
              setDiscarded(true);
            }}
          >
            捨てる
          </button>
        </div>
      )}
      {discarded && <p>退避したデータを捨てました。</p>}
      {(discarded || broken === null) && (
        <button type="button" className="secondary-button" autoFocus={discarded} onClick={() => setClosed(true)}>
          このお知らせを閉じる
        </button>
      )}
    </div>
  );
}

// 起動時の結果（壊れたデータ・使えない保存領域）と、保存中のお知らせ（書けない・別のタブ）
export function PersistenceNotices({
  boot,
  storage,
  persistence,
}: {
  boot: BootResult;
  storage: KeyValueStorage | null;
  persistence: Persistence;
}) {
  const [unavailableShown, setUnavailableShown] = useState(boot.kind === 'unavailable');

  return (
    <>
      {storage && <BrokenDataNotice boot={boot} storage={storage} />}
      {unavailableShown && boot.kind === 'unavailable' && (
        <div className="banner banner--info" role="status">
          <span>
            {boot.reason}。リロードすると内容は消えます。プライベートブラウズを使っている場合は、通常のウィンドウで開くと保存できます。
          </span>
          <button type="button" className="banner__dismiss" aria-label="閉じる" onClick={() => setUnavailableShown(false)}>
            ×
          </button>
        </div>
      )}
      {persistence.saveError && (
        <div className="banner banner--error" role="alert">
          {persistence.saveError}
          {persistence.lastSavedAt
            ? `。リロードすると、最後に保存できた ${hhmm(persistence.lastSavedAt)} の内容から再開します`
            : '。リロードすると、前回保存できた内容から再開します'}
        </div>
      )}
      {persistence.turnedOffByOtherTab && (
        <div className="banner banner--warning" role="status">
          別のタブで保存がオフにされたため、このタブも保存をやめました。保存するには「このブラウザに保存する」を入れ直してください。
        </div>
      )}
      {persistence.otherTabSaved && persistence.enabled && (
        <div className="banner banner--warning banner--stack" role="status">
          <span>
            別のタブでこのシミュレーターの状態が保存されました。このタブで操作を続けると、別のタブの内容を上書きします（後から保存したほうが残ります）。
          </span>
          <span className="banner__actions">
            <button type="button" className="secondary-button" onClick={persistence.reloadFromOtherTab}>
              別のタブの内容を読み込む（このタブの変更は捨てる）
            </button>
            <button type="button" className="secondary-button" onClick={persistence.dismissOtherTabNotice}>
              このタブで続ける
            </button>
          </span>
        </div>
      )}
    </>
  );
}

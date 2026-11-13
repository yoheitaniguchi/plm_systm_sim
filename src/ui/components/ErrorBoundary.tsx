// 描画中の例外で画面が消えたときの逃げ道（design.md PLM-EXT-25）。保存データが原因なら、
// 再読み込みしても同じ例外が出続けるので、保存データを退避してサンプルで起動し直せるようにする。
import { Component, type ReactNode } from 'react';
import { quarantineSavedState } from '../../domain/persistence';
import { browserStorage } from '../usePersistence';

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <main className="app-main">
        <div className="banner banner--error banner--stack" role="alert">
          <p>画面の表示中にエラーが起きました（{this.state.message}）。</p>
          <p>保存したデータが原因の場合、再読み込みしても同じエラーになります。保存データを退避して、木製イスのサンプルで起動し直せます（退避したデータは起動後に書き出せます）。</p>
          <span className="banner__actions">
            <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
              再読み込みする
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                quarantineSavedState(browserStorage());
                window.location.reload();
              }}
            >
              保存データを退避してサンプルで起動し直す
            </button>
          </span>
        </div>
      </main>
    );
  }
}

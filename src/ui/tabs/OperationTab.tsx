import { useState } from 'react';
import { checkInputOperations, currentMbomLines, linesUsingOperation } from '../../domain/mbom';
import { currentOperations } from '../../domain/operation';
import type { AppAction, AppState } from '../../domain/reducer';
import type { Operation } from '../../domain/types';

interface OperationTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

interface OperationForm {
  name: string;
  workCenter: string;
  stdTimeMin: number;
  description: string;
}

const EMPTY_FORM: OperationForm = { name: '', workCenter: '', stdTimeMin: 10, description: '' };

// 工程（BOP）タブ（design.md PLM-EXT-17・18）。内製品目ごとの工程の一覧・追加・改訂・順序の入れ替え・終了と、
// その品目を親とするM-BOM行の投入工程の割り当てを行う。判定はすべてドメイン側に任せ、ここでは表示と操作だけを持つ。
export function OperationTab({ state, dispatch }: OperationTabProps) {
  const makeItems = state.items.filter((i) => i.makeBuy === 'MAKE');
  const [selectedItemId, setSelectedItemId] = useState('');
  const itemId = makeItems.some((i) => i.itemId === selectedItemId) ? selectedItemId : (makeItems[0]?.itemId ?? '');

  const [addForm, setAddForm] = useState<OperationForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<{ operationId: string; form: OperationForm } | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  const workCenters = state.passthrough.workCenters;
  const operations = currentOperations(state.operations, itemId);
  const history = state.operations
    .filter((o) => o.itemId === itemId && o.effectiveToDay !== undefined)
    .sort((a, b) => a.opCode.localeCompare(b.opCode) || a.version - b.version);
  const inputLines = currentMbomLines(state.bomLines).filter((l) => l.parentItemId === itemId);
  const issues = checkInputOperations(state.bomLines, state.operations);
  const itemName = (id: string) => state.items.find((i) => i.itemId === id)?.name ?? id;
  const addWorkCenter = addForm.workCenter || workCenters[0]?.workCenter || '';

  const move = (index: number, delta: -1 | 1) => {
    const codes = operations.map((o) => o.opCode);
    [codes[index], codes[index + delta]] = [codes[index + delta], codes[index]];
    dispatch({ type: 'operation/reorder', itemId, opCodesInOrder: codes, effectiveFromDay: state.currentDay });
  };

  const startEditing = (o: Operation) =>
    setEditing({
      operationId: o.operationId,
      form: { name: o.name, workCenter: o.workCenter, stdTimeMin: o.stdTimeMin, description: o.description ?? '' },
    });

  return (
    <section aria-labelledby="operation-heading">
      <h2 id="operation-heading">工程（BOP）</h2>
      <p className="muted">
        内製品目をどの順序・どの作業区で作るかを定義します。工程はBOM行と同じく版で管理し、改訂・順序の入れ替え・終了の履歴を残します。
        改訂と順序の入れ替えは、その工程の有効開始日より後の日にできます（画面上部の「次の日へ進む」で日を進めます）。
      </p>
      <p className="muted">
        生産管理側へ書き出されるのは、順序・作業区・標準時間だけです。工程コード・名称・作業内容・投入工程はPLM側だけの情報です。
      </p>

      {issues.length > 0 && (
        <div className="banner banner--warning" role="status">
          投入工程が未割当または無効なM-BOM行が{issues.length}件あります：
          {[...new Set(issues.map((i) => i.parentItemId))].map((id) => `${itemName(id)}（${id}）`).join('、')}
        </div>
      )}

      {makeItems.length === 0 ? (
        <p>内製品目がありません。</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              対象の内製品目
              <select value={itemId} onChange={(e) => { setSelectedItemId(e.target.value); setEditing(null); setEndingId(null); }}>
                {makeItems.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}（{i.itemId}）
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>{itemName(itemId)}の工程</h3>
          {operations.length === 0 ? (
            <p>工程がまだありません。</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">順序</th>
                  <th scope="col">工程コード</th>
                  <th scope="col">名称</th>
                  <th scope="col">作業区</th>
                  <th scope="col">標準時間(分)</th>
                  <th scope="col">版</th>
                  <th scope="col">有効開始日</th>
                  <th scope="col">投入部品</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((o, index) => {
                  const users = linesUsingOperation(state.bomLines, o.itemId, o.opCode);
                  return (
                    <tr key={o.operationId}>
                      <td>{o.stepNo}</td>
                      <td>{o.opCode}</td>
                      <td>
                        {o.name}
                        {o.description && <div className="muted">{o.description}</div>}
                      </td>
                      <td>{o.workCenter}</td>
                      <td>{o.stdTimeMin}</td>
                      <td>{o.version}</td>
                      <td>D{o.effectiveFromDay}</td>
                      <td>{users.length === 0 ? 'なし' : users.map((l) => itemName(l.childItemId)).join('、')}</td>
                      <td>
                        <button type="button" className="secondary-button" disabled={index === 0} aria-label={`${o.opCode} ${o.name}を前へ`} onClick={() => move(index, -1)}>
                          ↑
                        </button>{' '}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={index === operations.length - 1}
                          aria-label={`${o.opCode} ${o.name}を後ろへ`}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>{' '}
                        <button type="button" className="secondary-button" aria-label={`${o.opCode} ${o.name}を改訂`} onClick={() => startEditing(o)}>
                          改訂
                        </button>{' '}
                        {endingId === o.operationId ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                dispatch({ type: 'operation/end', operationId: o.operationId, effectiveToDay: state.currentDay });
                                setEndingId(null);
                              }}
                            >
                              終了を確定
                            </button>{' '}
                            <button type="button" className="secondary-button" onClick={() => setEndingId(null)}>
                              やめる
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={users.length > 0}
                            title={users.length > 0 ? '投入部品がある工程は終了できません。先に投入工程を変えてください' : undefined}
                            aria-label={`${o.opCode} ${o.name}を終了`}
                            onClick={() => setEndingId(o.operationId)}
                          >
                            終了
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {editing && (
            <>
              <h3>工程の改訂（D{state.currentDay}から有効な新しい版を作ります）</h3>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  dispatch({
                    type: 'operation/revise',
                    operationId: editing.operationId,
                    patch: editing.form,
                    effectiveFromDay: state.currentDay,
                  });
                  setEditing(null);
                }}
              >
                <OperationFields form={editing.form} onChange={(form) => setEditing({ ...editing, form })} workCenters={workCenters.map((w) => w.workCenter)} />
                <button type="submit" className="primary-button">
                  改訂する
                </button>
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
                  やめる
                </button>
              </form>
            </>
          )}

          <h3>工程を追加</h3>
          {workCenters.length === 0 ? (
            <p>作業区は生産管理側のマスタです。MasterSnapshot を取り込んでください（連携タブ）。作業区が無い間は工程を追加できません。</p>
          ) : (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({
                  type: 'operation/add',
                  input: {
                    itemId,
                    name: addForm.name,
                    workCenter: addWorkCenter,
                    stdTimeMin: addForm.stdTimeMin,
                    description: addForm.description,
                    effectiveFromDay: state.currentDay,
                  },
                });
                setAddForm(EMPTY_FORM);
              }}
            >
              <OperationFields
                form={{ ...addForm, workCenter: addWorkCenter }}
                onChange={setAddForm}
                workCenters={workCenters.map((w) => w.workCenter)}
              />
              <button type="submit" className="primary-button">
                末尾に追加
              </button>
            </form>
          )}

          <h3>投入部品と投入工程</h3>
          <p className="muted">
            {itemName(itemId)}を親とするM-BOM行について、子品目をどの工程で投入するかを選びます。変換時は最初の工程が入ります。割り当てを変えても版は上がりません。
          </p>
          {inputLines.length === 0 ? (
            <p>この品目を親とするM-BOM行がありません（M-BOMタブで変換してください）。</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">子品目</th>
                  <th scope="col">員数</th>
                  <th scope="col">投入工程</th>
                </tr>
              </thead>
              <tbody>
                {inputLines.map((l) => {
                  const invalid = l.processStep !== undefined && !operations.some((o) => o.opCode === l.processStep);
                  return (
                    <tr key={l.bomLineId}>
                      <td>
                        {itemName(l.childItemId)}（{l.childItemId}）
                      </td>
                      <td>{l.qtyPer}</td>
                      <td>
                        {operations.length === 0 ? (
                          '未割当（この品目に工程がありません）'
                        ) : (
                          <select
                            aria-label={`${l.childItemId}の投入工程`}
                            value={invalid ? '' : (l.processStep ?? '')}
                            onChange={(e) => dispatch({ type: 'mbom/assignOperation', bomLineId: l.bomLineId, opCode: e.target.value || undefined })}
                          >
                            <option value="">未割当</option>
                            {operations.map((o) => (
                              <option key={o.opCode} value={o.opCode}>
                                {o.opCode} {o.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {invalid && <span className="badge badge--warning">無効: {l.processStep}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {history.length > 0 && (
            <>
              <h3>履歴（旧版・終了した工程）</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">工程コード</th>
                    <th scope="col">版</th>
                    <th scope="col">順序</th>
                    <th scope="col">名称</th>
                    <th scope="col">作業区</th>
                    <th scope="col">標準時間(分)</th>
                    <th scope="col">有効期間</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((o) => (
                    <tr key={o.operationId}>
                      <td>{o.opCode}</td>
                      <td>{o.version}</td>
                      <td>{o.stepNo}</td>
                      <td>{o.name}</td>
                      <td>{o.workCenter}</td>
                      <td>{o.stdTimeMin}</td>
                      <td>
                        D{o.effectiveFromDay}〜D{o.effectiveToDay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}

interface OperationFieldsProps {
  form: OperationForm;
  onChange: (form: OperationForm) => void;
  workCenters: string[];
}

// 追加と改訂で共通の入力欄。作業区は取り込み済みの一覧から選ぶ（入力欄は無い）
function OperationFields({ form, onChange, workCenters }: OperationFieldsProps) {
  return (
    <>
      <label>
        名称
        <input required value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
      </label>
      <label>
        作業区（取り込み済みの作業区から選びます）
        <select required value={form.workCenter} onChange={(e) => onChange({ ...form, workCenter: e.target.value })}>
          {/* 改訂する工程の作業区が、取り込み直しで一覧から消えている場合にも現在の値を見せる */}
          {!workCenters.includes(form.workCenter) && form.workCenter !== '' && (
            <option value={form.workCenter}>{form.workCenter}（取り込み済みに無し）</option>
          )}
          {workCenters.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label>
        標準時間（分）
        <input
          type="number"
          min={0}
          step="any"
          required
          value={form.stdTimeMin}
          onChange={(e) => onChange({ ...form, stdTimeMin: Number(e.target.value) })}
        />
      </label>
      <label>
        作業内容（任意）
        <input value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </label>
    </>
  );
}

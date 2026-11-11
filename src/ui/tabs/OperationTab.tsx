import { useState } from 'react';
import { checkInputOperations, currentMbomLines, linesUsingOperation } from '../../domain/mbom';
import { canReviseOn, currentOperations } from '../../domain/operation';
import { resourcesOfOperation } from '../../domain/resource';
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
  // 改訂フォームの対象は工程コードで持つ（版や順序が変わっても不変）。開いたときの版（operationId）も覚えておき、
  // その版が現行でなくなったら（改訂が成功した・入れ替えや終了で旧版化した）フォームを出さない。
  // 改訂が拒否されたときは版が変わらないので、入力はそのまま残る
  const [editingState, setEditing] = useState<{ opCode: string; operationId: string; form: OperationForm } | null>(null);
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
  const editingTarget = editingState ? operations.find((o) => o.operationId === editingState.operationId) : undefined;
  const editing = editingState && editingTarget ? editingState : null;
  const lockedToday = operations.filter((o) => !canReviseOn(o, state.currentDay));
  const ending = operations.find((o) => o.operationId === endingId);

  const move = (index: number, delta: -1 | 1) => {
    const codes = operations.map((o) => o.opCode);
    [codes[index], codes[index + delta]] = [codes[index + delta], codes[index]];
    dispatch({ type: 'operation/reorder', itemId, opCodesInOrder: codes, effectiveFromDay: state.currentDay });
  };

  // 入れ替えは、動く2つの工程の両方に新しい版を作れる日でないとできない
  const canMove = (index: number, delta: -1 | 1) =>
    canReviseOn(operations[index], state.currentDay) && canReviseOn(operations[index + delta], state.currentDay);

  const startEditing = (o: Operation) =>
    setEditing({
      opCode: o.opCode,
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
        <p>内製品目がありません。品目タブで登録するか、連携タブで MasterSnapshot を取り込んでください。</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              対象の内製品目
              <select
                value={itemId}
                onChange={(e) => {
                  setSelectedItemId(e.target.value);
                  setEditing(null);
                  setEndingId(null);
                  setAddForm(EMPTY_FORM);
                }}
              >
                {makeItems.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}（{i.itemId}）
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3 id="operation-list-heading">{itemName(itemId)}の工程</h3>
          {lockedToday.length > 0 && (
            <p>
              現在日D{state.currentDay}では、有効開始日がD{state.currentDay}以降の工程（{lockedToday.map((o) => o.opCode).join('・')}
              ）は改訂・順序の入れ替えができません。{' '}
              <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'ui/advanceDay', byDays: 1 })}>
                日を進める（D{state.currentDay + 1}へ）
              </button>
            </p>
          )}
          <p className="muted">投入部品や資源がある工程は終了できません。先に下の「投入部品と投入工程」で投入工程を変えるか、「資源（BOR）」タブで資源を削除してください。</p>
          {operations.length === 0 ? (
            <p>工程がまだありません。下の「工程を追加」から登録してください。</p>
          ) : (
            <table className="data-table" aria-labelledby="operation-list-heading">
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
                  <th scope="col">資源</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((o, index) => {
                  const users = linesUsingOperation(state.bomLines, o.itemId, o.opCode);
                  const resourceCount = resourcesOfOperation(state.operationResources, o.itemId, o.opCode).length;
                  const endBlockedBy = [users.length > 0 ? '投入部品' : '', resourceCount > 0 ? '資源' : ''].filter(Boolean);
                  return (
                    <tr key={o.opCode}>
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
                      <td>{resourceCount}件</td>
                      <td className="actions-cell">
                        <button type="button" className="secondary-button" disabled={index === 0 || !canMove(index, -1)} aria-label={`${o.opCode} ${o.name}を前へ`} onClick={() => move(index, -1)}>
                          ↑
                        </button>{' '}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={index === operations.length - 1 || !canMove(index, 1)}
                          aria-label={`${o.opCode} ${o.name}を後ろへ`}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>{' '}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!canReviseOn(o, state.currentDay)}
                          aria-label={`${o.opCode} ${o.name}を改訂`}
                          onClick={() => startEditing(o)}
                        >
                          改訂
                        </button>{' '}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={endBlockedBy.length > 0}
                          aria-label={`${o.opCode} ${o.name}を終了`}
                          onClick={() => setEndingId(o.operationId)}
                        >
                          終了
                        </button>
                        {endBlockedBy.length > 0 && <span className="muted">{endBlockedBy.join('・')}あり（終了不可）</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {ending &&
            linesUsingOperation(state.bomLines, ending.itemId, ending.opCode).length === 0 &&
            resourcesOfOperation(state.operationResources, ending.itemId, ending.opCode).length === 0 && (
            <div className="banner banner--warning">
              <p>
                {ending.opCode} {ending.name}をD{state.currentDay}で終了します。元に戻せず、工程コード{ending.opCode}は再利用されません。
                {operations.length === 1 && 'この品目の工程が無くなります（工順の無い内製品目は、生産管理側で計画オーダを確定できません）。'}
              </p>
              <div className="actions-cell">
                <button type="button" className="secondary-button" autoFocus onClick={() => setEndingId(null)}>
                  終了をやめる
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    dispatch({ type: 'operation/end', operationId: ending.operationId, effectiveToDay: state.currentDay });
                    setEndingId(null);
                  }}
                >
                  {ending.opCode} {ending.name}の終了を確定
                </button>
              </div>
            </div>
          )}

          {editing && editingTarget && (
            <>
              <h3 id="operation-revise-heading">
                {editingTarget.opCode} {editingTarget.name}の改訂（版{editingTarget.version + 1}をD{state.currentDay}から有効にします）
              </h3>
              <form
                aria-labelledby="operation-revise-heading"
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  dispatch({
                    type: 'operation/revise',
                    operationId: editing.operationId,
                    // 変えた項目だけを送る（変えていない作業区まで検査で拒否されないようにする）
                    patch: {
                      name: editing.form.name !== editingTarget.name ? editing.form.name : undefined,
                      workCenter: editing.form.workCenter !== editingTarget.workCenter ? editing.form.workCenter : undefined,
                      stdTimeMin: editing.form.stdTimeMin !== editingTarget.stdTimeMin ? editing.form.stdTimeMin : undefined,
                      description: editing.form.description !== (editingTarget.description ?? '') ? editing.form.description : undefined,
                    },
                    effectiveFromDay: state.currentDay,
                  });
                  // 閉じない：改訂が成功すれば対象の版が旧版になり、フォームは自動的に消える。拒否されたら入力を残す
                }}
              >
                <OperationFields form={editing.form} onChange={(form) => setEditing({ ...editing, form })} workCenters={workCenters.map((w) => w.workCenter)} />
                <button type="submit" className="primary-button">
                  改訂する
                </button>
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
                  改訂をやめる
                </button>
              </form>
            </>
          )}

          <h3 id="operation-add-heading">工程を追加</h3>
          {workCenters.length === 0 ? (
            <p>作業区は生産管理側のマスタです。MasterSnapshot を取り込んでください（連携タブ）。作業区が無い間は工程を追加できません。</p>
          ) : (
            <form
              aria-labelledby="operation-add-heading"
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
                {itemName(itemId)}の末尾に追加
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
            <table className="data-table" aria-label="投入部品と投入工程">
              <thead>
                <tr>
                  <th scope="col">子品目</th>
                  <th scope="col">員数</th>
                  <th scope="col">投入工程</th>
                </tr>
              </thead>
              <tbody>
                {inputLines.map((l) => {
                  const invalid = issues.some((i) => i.bomLineId === l.bomLineId && i.parentItemId === itemId && i.kind === '無効');
                  return (
                    <tr key={l.bomLineId}>
                      <td>
                        {itemName(l.childItemId)}（{l.childItemId}）
                      </td>
                      <td>{l.qtyPer}</td>
                      <td>
                        {operations.length === 0 ? (
                          '未割当（この品目に工程がありません。上の「工程を追加」から登録してください）'
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
              <table className="data-table" aria-label="工程の履歴">
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

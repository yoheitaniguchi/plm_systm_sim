import { useState } from "react";
import {
  currentEbomLines,
  ebomLineBlockers,
  wouldCreateCycle,
  wouldDuplicateOnReplace,
} from "../../domain/ebom";
import type { AppAction, AppState } from "../../domain/reducer";
import {
  deriveRevisions,
  diffRevisions,
  itemsWithRevisions,
} from "../../domain/revision";
import type { PlmBomLine } from "../../domain/types";

interface EbomChangePanelProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

type Mode = "revise" | "replace" | "end";

interface Editing {
  bomLineId: string;
  mode: Mode;
  qtyPer: number;
  newChildItemId: string;
  parentItemId: string;
}

const MODE_LABEL: Record<Mode, string> = {
  revise: "員数を改訂",
  replace: "子品目を置換",
  end: "終了",
};

// E-BOM行の改訂・終了・置換と、品目リビジョンの履歴・比較（design.md PLM-EXT-21〜23）。
// 判定はドメイン側（ebom.ts・revision.ts）に任せ、ここでは表示と操作だけを持つ。
export function EbomChangePanel({ state, dispatch }: EbomChangePanelProps) {
  const lines = currentEbomLines(state.bomLines);
  const day = state.currentDay;
  const label = (id: string) => {
    const item = state.items.find((i) => i.itemId === id);
    return item ? `${item.name}（${id}）` : id;
  };

  // 操作の対象は行IDで持つ。改訂・置換・終了が成功するとその行は現行でなくなるので、フォームは自動で閉じる。
  // 拒否されたときは行が現行のままなので、入力は残る
  const [editingState, setEditing] = useState<Editing | null>(null);
  const [changeId, setChangeId] = useState("");
  const editingLine = editingState
    ? lines.find((l) => l.bomLineId === editingState.bomLineId)
    : undefined;
  const editing = editingState && editingLine ? editingState : null;
  const origin = state.changes.some((c) => c.changeId === changeId)
    ? changeId
    : undefined;

  const revisionItems = itemsWithRevisions(state.bomLines);
  const [selectedItemId, setSelectedItemId] = useState("");
  const itemId = revisionItems.includes(selectedItemId)
    ? selectedItemId
    : (revisionItems[0] ?? "");
  const revisions = itemId ? deriveRevisions(itemId, state.bomLines, day) : [];
  const [compare, setCompare] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const hasRev = (rev: string) => revisions.some((r) => r.rev === rev);
  // 既定は「1つ前 → 最新」
  const fromRev = hasRev(compare.from)
    ? compare.from
    : (revisions[revisions.length - 2]?.rev ?? "");
  const toRev = hasRev(compare.to)
    ? compare.to
    : (revisions[revisions.length - 1]?.rev ?? "");
  const from = revisions.find((r) => r.rev === fromRev);
  const to = revisions.find((r) => r.rev === toRev);
  const diff = from && to && from !== to ? diffRevisions(from, to) : [];

  const lockedToday = lines.some(
    (l) => ebomLineBlockers(state.bomLines, l, day).day !== undefined,
  );
  const lineName = (l: PlmBomLine) => `${l.parentItemId} → ${l.childItemId}`;
  const period = (fromDay: number, toDay?: number) =>
    toDay === undefined ? `D${fromDay}〜` : `D${fromDay}〜D${toDay - 1}`;

  // 由来の変更は操作ごとに選び直す（前の操作の選択を持ち越さない）
  const start = (l: PlmBomLine, mode: Mode) => {
    setEditing({
      bomLineId: l.bomLineId,
      mode,
      qtyPer: l.qtyPer,
      newChildItemId: "",
      parentItemId: l.parentItemId,
    });
    setChangeId("");
  };
  // 操作が成功すると対象の行が現行でなくなる。そのときは入力欄の代わりに結果を伝える
  const done = editingState && !editingLine ? editingState : null;
  const doneRevision = done
    ? deriveRevisions(done.parentItemId, state.bomLines, day).find(
        (r) => r.fromDay === day,
      )
    : undefined;
  const unchanged =
    editing?.mode === "revise" &&
    editingLine !== undefined &&
    editing.qtyPer === editingLine.qtyPer;

  const submit = () => {
    if (!editing || !editingLine) return;
    if (editing.mode === "revise") {
      dispatch({
        type: "ebom/reviseLine",
        bomLineId: editing.bomLineId,
        patch: { qtyPer: editing.qtyPer },
        effectiveFromDay: day,
        changeId: origin,
      });
    } else if (editing.mode === "replace") {
      dispatch({
        type: "ebom/replaceChild",
        bomLineId: editing.bomLineId,
        newChildItemId: editing.newChildItemId,
        effectiveFromDay: day,
        changeId: origin,
      });
    } else {
      dispatch({
        type: "ebom/endLine",
        bomLineId: editing.bomLineId,
        effectiveFromDay: day,
        changeId: origin,
      });
    }
  };

  return (
    <>
      <h3 id="ebom-change-heading">E-BOM行の改訂・終了・置換</h3>
      <p className="muted">
        行を変えると、旧い行は履歴に残り、今日（D{day}
        ）から新しい内容が有効になります（旧い行は前日まで有効）。
        行を変えた日が、親品目のリビジョンの区切りになります。M-BOMは自動では変わらないので、変更後に「M-BOM」タブで変換し直してください。
      </p>
      {lockedToday && (
        <div className="banner banner--info">
          <p role="status">
            今日（D{day}
            ）に始まった行は、同じ日には変更できません（新しい版の開始日は、旧い版より後にします）。
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => dispatch({ type: "ui/advanceDay", byDays: 1 })}
          >
            日を進める（D{day + 1}へ）
          </button>
        </div>
      )}
      <table className="data-table" aria-labelledby="ebom-change-heading">
        <thead>
          <tr>
            <th scope="col">親品目</th>
            <th scope="col">子品目</th>
            <th scope="col">員数</th>
            <th scope="col">版</th>
            <th scope="col">開始日</th>
            <th scope="col">由来の変更</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const blockers = ebomLineBlockers(state.bomLines, l, day);
            const notes: string[] = [];
            if (blockers.day) notes.push(blockers.day);
            if (blockers.end && blockers.end === blockers.replace)
              notes.push(`${blockers.end}のため終了・置換不可`);
            else {
              if (blockers.end) notes.push(`${blockers.end}のため終了不可`);
              if (blockers.replace)
                notes.push(`${blockers.replace}のため置換不可`);
            }
            return (
              <tr key={l.bomLineId}>
                <td>{label(l.parentItemId)}</td>
                <td>
                  {label(l.childItemId)}
                  {l.optionCode && (
                    <span className="badge badge--option">{l.optionCode}</span>
                  )}
                </td>
                <td>{l.qtyPer}</td>
                <td>{l.version}</td>
                <td>D{l.effectiveFromDay}</td>
                <td>{l.changeId ?? "—"}</td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={blockers.day !== undefined}
                    aria-label={`${lineName(l)} の員数を改訂`}
                    onClick={() => start(l, "revise")}
                  >
                    員数を改訂
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      blockers.day !== undefined ||
                      blockers.replace !== undefined
                    }
                    aria-label={`${lineName(l)} の子品目を置換`}
                    onClick={() => start(l, "replace")}
                  >
                    置換
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      blockers.day !== undefined || blockers.end !== undefined
                    }
                    aria-label={`${lineName(l)} を終了`}
                    onClick={() => start(l, "end")}
                  >
                    終了
                  </button>
                  {notes.length > 0 && (
                    <span className="muted">{notes.join("・")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lines.length === 0 && (
        <p className="muted">
          E-BOMに行がありません。上の「E-BOM行を追加」から登録してください。
        </p>
      )}

      {done && (
        <div className="banner banner--info" role="status">
          {MODE_LABEL[done.mode]}を D{day} から反映しました。
          {doneRevision &&
            `${label(done.parentItemId)} はリビジョン ${doneRevision.rev} になりました（下の「リビジョン履歴」で確認できます）。`}
          M-BOMへ反映するには「M-BOM」タブで変換し直してください。
        </div>
      )}

      {editing && editingLine && (
        <>
          <h4 id="ebom-edit-heading">
            {MODE_LABEL[editing.mode]}：{label(editingLine.parentItemId)} →{" "}
            {label(editingLine.childItemId)}
          </h4>
          {state.lastError && (
            <div className="banner banner--error" role="alert">
              {state.lastError}
            </div>
          )}
          {editing.mode === "end" && (
            <p className="banner banner--warning">
              この行を D{day} から無効にします（D{day - 1}{" "}
              までは有効だった行として履歴に残ります）。元には戻せません。
              もう一度使うときは、行を追加し直してください。
              {label(editingLine.parentItemId)} のリビジョンが上がり、
              ほかに子が無ければ「子なし」のリビジョンになります。M-BOMは「M-BOM」タブで変換し直すまで変わりません。
            </p>
          )}
          <form
            aria-labelledby="ebom-edit-heading"
            className="form-grid"
            ref={(el) => el?.scrollIntoView?.({ block: "nearest" })}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {editing.mode === "revise" && (
              <label>
                新しい員数（今は {editingLine.qtyPer}）
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  required
                  autoFocus
                  value={editing.qtyPer}
                  onChange={(e) =>
                    setEditing({ ...editing, qtyPer: Number(e.target.value) })
                  }
                />
              </label>
            )}
            {editing.mode === "replace" && (
              <label>
                置換後の子品目（員数 {editingLine.qtyPer} はそのまま）
                <select
                  required
                  autoFocus
                  value={editing.newChildItemId}
                  onChange={(e) =>
                    setEditing({ ...editing, newChildItemId: e.target.value })
                  }
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {/* 確実に拒否される候補（E-BOM限定グループを畳んだ後の親が既に持つ子・循環になる品目。判定はドメインと共有）は出さない */}
                  {state.items
                    .filter(
                      (i) =>
                        i.itemId !== editingLine.childItemId &&
                        !wouldDuplicateOnReplace(lines, editingLine, i.itemId) &&
                        !wouldCreateCycle(
                          state.bomLines,
                          "E",
                          editingLine.parentItemId,
                          i.itemId,
                        ),
                    )
                    .map((i) => (
                      <option key={i.itemId} value={i.itemId}>
                        {i.name}（{i.itemId}）
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              由来の変更（任意。記録するだけで、ECOの影響BOM行には追加されません）
              <select
                value={origin ?? ""}
                onChange={(e) => setChangeId(e.target.value)}
              >
                <option value="">指定しない</option>
                {state.changes.map((c) => (
                  <option key={c.changeId} value={c.changeId}>
                    {c.changeId}（{c.status}）
                  </option>
                ))}
              </select>
            </label>
            <div className="actions-cell">
              <button
                type="button"
                className="secondary-button"
                autoFocus={editing.mode === "end"}
                onClick={() => setEditing(null)}
              >
                やめる
              </button>
              <button
                type="submit"
                className={
                  editing.mode === "end" ? "danger-button" : "primary-button"
                }
                disabled={unchanged}
              >
                {editing.mode === "revise" && `D${day} から員数を変える`}
                {editing.mode === "replace" && `D${day} から置き換える`}
                {editing.mode === "end" && `D${day} で終了する`}
              </button>
              {unchanged && (
                <span className="muted">
                  今の員数と同じです。変える値を入力してください
                </span>
              )}
            </div>
          </form>
        </>
      )}

      <h3 id="revision-history-heading">リビジョン履歴</h3>
      <p className="muted">
        品目のリビジョン（A・B・C…）は、その品目の直下の構成（E-BOM行）が変わった日で区切って自動的に付けます。
        子の構成が変わっても、上位の品目のリビジョンは上がりません。状態は「予定（開始日がまだ先）／有効／旧版」の3つです。
      </p>
      {revisionItems.length === 0 ? (
        <p className="muted">E-BOMに行がありません。</p>
      ) : (
        <>
          <label>
            リビジョンを見る品目
            <select
              value={itemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
            >
              {revisionItems.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </label>
          <table
            className="data-table"
            aria-labelledby="revision-history-heading"
          >
            <thead>
              <tr>
                <th scope="col">リビジョン</th>
                <th scope="col">期間</th>
                <th scope="col">状態</th>
                <th scope="col">構成（子品目×員数）</th>
                <th scope="col">由来の変更</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.rev}>
                  <th scope="row">{r.rev}</th>
                  <td>{period(r.fromDay, r.toDay)}</td>
                  <td>
                    {r.status === "有効" ? (
                      <strong>{r.status}</strong>
                    ) : (
                      r.status
                    )}
                  </td>
                  <td>
                    {r.lines.length === 0
                      ? "子なし"
                      : r.lines
                          .map(
                            (l) =>
                              `${label(l.childItemId)}×${l.qtyPer}${l.optionCode ? `〈${l.optionCode}〉` : ""}`,
                          )
                          .join("、")}
                  </td>
                  <td>
                    {r.changeIds.length > 0 ? r.changeIds.join("、") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 id="revision-diff-heading">リビジョン比較：{label(itemId)}</h3>
          {revisions.length < 2 ? (
            <p className="muted">
              この品目のリビジョンは1つだけです。上の表で行を改訂・終了・置換すると、次のリビジョンができます。
            </p>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  比較元
                  <select
                    value={fromRev}
                    onChange={(e) =>
                      setCompare({ from: e.target.value, to: toRev })
                    }
                  >
                    {revisions.map((r) => (
                      <option key={r.rev} value={r.rev}>
                        {r.rev}（{period(r.fromDay, r.toDay)}）
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  比較先
                  <select
                    value={toRev}
                    onChange={(e) =>
                      setCompare({ from: fromRev, to: e.target.value })
                    }
                  >
                    {revisions.map((r) => (
                      <option key={r.rev} value={r.rev}>
                        {r.rev}（{period(r.fromDay, r.toDay)}）
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {fromRev === toRev ? (
                <p className="muted">
                  比較元と比較先に、別のリビジョンを選んでください。
                </p>
              ) : diff.length === 0 ? (
                <p className="muted">
                  {fromRev} と {toRev} の間で、子品目と員数に違いはありません。
                </p>
              ) : (
                <table
                  className="data-table"
                  aria-label={`${label(itemId)} のリビジョン ${fromRev} から ${toRev} への差分`}
                >
                  <thead>
                    <tr>
                      <th scope="col">差分</th>
                      <th scope="col">子品目</th>
                      <th scope="col">{fromRev} の員数</th>
                      <th scope="col">{toRev} の員数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr
                        key={`${d.kind}-${d.childItemId}-${d.optionGroupId ?? ""}-${d.optionCode ?? ""}`}
                      >
                        <td>{d.kind}</td>
                        <td>
                          {label(d.childItemId)}
                          {d.optionCode && (
                            <span className="badge badge--option">
                              {d.optionCode}
                            </span>
                          )}
                        </td>
                        <td>{d.qtyBefore ?? "—"}</td>
                        <td>{d.qtyAfter ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

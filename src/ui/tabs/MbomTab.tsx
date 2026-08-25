import { useState } from 'react';
import { currentEbomLines } from '../../domain/ebom';
import { checkMbomStaleness, currentMbomLines } from '../../domain/mbom';
import { effectiveMbomLines } from '../../domain/reducer';
import type { AppAction, AppState } from '../../domain/reducer';
import { BomTree } from '../components/BomTree';

interface MbomTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

function topLevelItemIds(lines: { parentItemId: string; childItemId: string }[]): string[] {
  const childIds = new Set(lines.map((l) => l.childItemId));
  const parentIds = new Set(lines.map((l) => l.parentItemId));
  return [...parentIds].filter((id) => !childIds.has(id));
}

export function MbomTab({ state, dispatch }: MbomTabProps) {
  const ebomLines = currentEbomLines(state.bomLines);
  const rawMbomLines = currentMbomLines(state.bomLines);
  const resolvedMbomLines = effectiveMbomLines(state);
  const roots = topLevelItemIds(resolvedMbomLines);
  const staleness = checkMbomStaleness(ebomLines, rawMbomLines);

  const [configId, setConfigId] = useState('');

  const alternateGroups = new Map<string, string>();
  for (const line of rawMbomLines) {
    if (line.alternateGroupId) alternateGroups.set(line.alternateGroupId, line.alternateGroupId);
  }

  return (
    <section aria-labelledby="mbom-heading">
      <h2 id="mbom-heading">M-BOM（製造部品表）</h2>
      <p className="muted">E-BOMをM-BOMへ変換すると、「脚部ユニット」のようなE-BOM限定グループは消滅し、子品目が直接ぶら下がります。</p>

      {staleness.length > 0 && (
        <div className="banner banner--warning" role="status">
          {staleness.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const routingMap = Object.fromEntries(state.passthrough.routingSteps.map((s) => [s.itemId, s.workCenter]));
          const config = state.configurations.find((c) => c.configId === configId);
          dispatch({
            type: 'mbom/convert',
            routingMap,
            effectiveFromDay: state.currentDay,
            configuration: config
              ? { baseItemId: config.baseItemId, selections: config.selections, resolvedItemId: config.resolvedItemId }
              : undefined,
          });
        }}
      >
        <label>
          使用する確定済み構成（バリアントが無ければ「なし」のまま）
          <select value={configId} onChange={(e) => setConfigId(e.target.value)}>
            <option value="">なし</option>
            {state.configurations.map((c) => (
              <option key={c.configId} value={c.configId}>
                {c.baseItemId} → {c.resolvedItemId}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-button">
          M-BOMに変換
        </button>
      </form>

      {[...alternateGroups.keys()].map((groupId) => {
        const candidates = rawMbomLines.filter((l) => l.alternateGroupId === groupId && l.approvalStatus === '承認済');
        const currentChoice = resolvedMbomLines.find((l) => l.alternateGroupId === groupId)?.childItemId;
        return (
          <div key={groupId} className="form-grid">
            <label>
              代替部品グループ「{groupId}」の選択（4.5）
              <select
                value={currentChoice ?? ''}
                onChange={(e) => dispatch({ type: 'mbom/setAlternateOverride', alternateGroupId: groupId, childItemId: e.target.value })}
              >
                {candidates
                  .sort((a, b) => (a.alternatePriority ?? 99) - (b.alternatePriority ?? 99))
                  .map((l) => (
                    <option key={l.childItemId} value={l.childItemId}>
                      {l.childItemId}（優先順位{l.alternatePriority}）
                    </option>
                  ))}
              </select>
            </label>
          </div>
        );
      })}

      {roots.map((root) => (
        <div key={root} className="tree-card">
          <h3>{root}</h3>
          <BomTree rootItemId={root} lines={resolvedMbomLines} items={state.items} />
        </div>
      ))}
    </section>
  );
}

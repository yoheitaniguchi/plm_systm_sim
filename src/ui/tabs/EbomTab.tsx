import { useState } from 'react';
import { currentEbomLines } from '../../domain/ebom';
import { generateNewItemCode } from '../../domain/item';
import type { AppAction, AppState } from '../../domain/reducer';
import type { ItemCodePrefix } from '../../domain/types';
import { BomTree } from '../components/BomTree';

interface EbomTabProps {
  state: AppState;
  dispatch: (action: AppAction) => void;
}

function topLevelItemIds(state: AppState): string[] {
  const lines = currentEbomLines(state.bomLines);
  const childIds = new Set(lines.map((l) => l.childItemId));
  const parentIds = new Set(lines.map((l) => l.parentItemId));
  return [...parentIds].filter((id) => !childIds.has(id));
}

export function EbomTab({ state, dispatch }: EbomTabProps) {
  const lines = currentEbomLines(state.bomLines);
  const roots = topLevelItemIds(state);

  const optionGroups = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line.optionGroupId || !line.optionCode) continue;
    const codes = optionGroups.get(line.optionGroupId) ?? new Set<string>();
    codes.add(line.optionCode);
    optionGroups.set(line.optionGroupId, codes);
  }

  const [addForm, setAddForm] = useState({ parentItemId: '', childItemId: '', qtyPer: 1 });
  const [variantForm, setVariantForm] = useState<{ baseItemId: string; selections: Record<string, string>; resolvedItemId: string; resolvedItemName: string }>({
    baseItemId: roots[0] ?? '',
    selections: {},
    resolvedItemId: '',
    resolvedItemName: '',
  });

  return (
    <section aria-labelledby="ebom-heading">
      <h2 id="ebom-heading">E-BOM（設計部品表）</h2>
      <p className="muted">
        設計視点の部品表です。「脚部ユニット」のようなE-BOM限定の機能グループや、未解決のオプショングループ（150%BOM）を含みます。
      </p>

      {roots.map((root) => (
        <div key={root} className="tree-card">
          <h3>{root}</h3>
          <BomTree rootItemId={root} lines={lines} items={state.items} />
        </div>
      ))}

      <h3>E-BOM行を追加</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: 'ebom/addLine',
            input: {
              bomLineId: `E-${crypto.randomUUID().slice(0, 8)}`,
              parentItemId: addForm.parentItemId,
              childItemId: addForm.childItemId,
              qtyPer: addForm.qtyPer,
              effectiveFromDay: state.currentDay,
            },
          });
          setAddForm({ parentItemId: '', childItemId: '', qtyPer: 1 });
        }}
      >
        <label>
          親品目
          <input required value={addForm.parentItemId} onChange={(e) => setAddForm({ ...addForm, parentItemId: e.target.value })} />
        </label>
        <label>
          子品目
          <input required value={addForm.childItemId} onChange={(e) => setAddForm({ ...addForm, childItemId: e.target.value })} />
        </label>
        <label>
          員数
          <input
            type="number"
            min={0.01}
            step="any"
            required
            value={addForm.qtyPer}
            onChange={(e) => setAddForm({ ...addForm, qtyPer: Number(e.target.value) })}
          />
        </label>
        <button type="submit" className="primary-button">
          追加（循環参照は登録時に拒否されます）
        </button>
      </form>

      {optionGroups.size > 0 && (
        <>
          <h3>バリアント構成の解決（4.4）</h3>
          <p className="muted">
            オプショングループを1つ選び構成を確定します。「無垢材」を選ぶと元の品目のまま、「布張り」を選ぶと新しい品目が生まれます。
          </p>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({
                type: 'variant/resolveConfiguration',
                baseItemId: variantForm.baseItemId,
                selections: variantForm.selections,
                resolvedItemId: variantForm.resolvedItemId || variantForm.baseItemId,
                resolvedItemName: variantForm.resolvedItemName || variantForm.baseItemId,
              });
            }}
          >
            <label>
              対象の完成品
              <select value={variantForm.baseItemId} onChange={(e) => setVariantForm({ ...variantForm, baseItemId: e.target.value })}>
                {roots.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {[...optionGroups.entries()].map(([groupId, codes]) => (
              <label key={groupId}>
                {groupId}
                <select
                  required
                  value={variantForm.selections[groupId] ?? ''}
                  onChange={(e) =>
                    setVariantForm({ ...variantForm, selections: { ...variantForm.selections, [groupId]: e.target.value } })
                  }
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {[...codes].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              確定後の品目コード（変わらない場合は空欄のまま）
              <input
                value={variantForm.resolvedItemId}
                placeholder={variantForm.baseItemId}
                onChange={(e) => setVariantForm({ ...variantForm, resolvedItemId: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const prefix = variantForm.baseItemId.split('-')[0] as ItemCodePrefix;
                const existing = new Set(state.items.map((i) => i.itemId));
                setVariantForm({ ...variantForm, resolvedItemId: generateNewItemCode(prefix, variantForm.baseItemId, existing) });
              }}
            >
              新しい品目コードを提案（4.3）
            </button>
            <label>
              確定後の品目名
              <input value={variantForm.resolvedItemName} onChange={(e) => setVariantForm({ ...variantForm, resolvedItemName: e.target.value })} />
            </label>
            <button type="submit" className="primary-button">
              構成を確定する
            </button>
          </form>

          {state.configurations.length > 0 && (
            <ul className="plain-list">
              {state.configurations.map((c) => (
                <li key={c.configId}>
                  {c.configId}: {c.baseItemId} → {c.resolvedItemId}（{JSON.stringify(c.selections)}）
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

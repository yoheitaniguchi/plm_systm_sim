import { isEbomOnlyGroup } from '../../domain/ebom';
import { MAX_BOM_DEPTH } from '../../domain/impactAnalysis';
import type { PlmBomLine, PlmItem } from '../../domain/types';

interface BomTreeProps {
  rootItemId: string;
  lines: PlmBomLine[];
  items: PlmItem[];
  highlightItemId?: string;
}

function itemLabel(itemId: string, items: PlmItem[]): string {
  const item = items.find((i) => i.itemId === itemId);
  return item ? `${item.name}（${itemId}）` : itemId;
}

export function BomTree({ rootItemId, lines, items, highlightItemId }: BomTreeProps) {
  return (
    <ul className="bom-tree" role="tree">
      <BomNode
        itemId={rootItemId}
        qty={1}
        lines={lines}
        items={items}
        depth={0}
        visited={new Set()}
        highlightItemId={highlightItemId}
      />
    </ul>
  );
}

interface BomNodeProps {
  itemId: string;
  qty: number;
  lines: PlmBomLine[];
  items: PlmItem[];
  depth: number;
  visited: Set<string>;
  highlightItemId?: string;
  optionCode?: string;
  isAlternate?: boolean;
}

function BomNode({ itemId, qty, lines, items, depth, visited, highlightItemId, optionCode, isAlternate }: BomNodeProps) {
  if (depth > MAX_BOM_DEPTH || visited.has(itemId)) {
    return (
      <li role="treeitem">
        <span className="bom-node bom-node--warning">{itemLabel(itemId, items)}（これ以上展開しません）</span>
      </li>
    );
  }
  const nextVisited = new Set(visited);
  nextVisited.add(itemId);

  const children = lines.filter((l) => l.parentItemId === itemId);
  const isGroup = isEbomOnlyGroup(itemId, lines);

  return (
    <li role="treeitem">
      <span className={`bom-node${itemId === highlightItemId ? ' bom-node--highlight' : ''}`}>
        {itemLabel(itemId, items)}
        {qty !== 1 && <span className="bom-node__qty"> × {qty}</span>}
        {isGroup && <span className="badge badge--ebom-only">E-BOM限定</span>}
        {optionCode && <span className="badge badge--option">オプション: {optionCode}</span>}
        {isAlternate && <span className="badge badge--alternate">代替</span>}
      </span>
      {children.length > 0 && (
        <ul>
          {children.map((line) => (
            <BomNode
              key={line.bomLineId}
              itemId={line.childItemId}
              qty={line.qtyPer}
              lines={lines}
              items={items}
              depth={depth + 1}
              visited={nextVisited}
              highlightItemId={highlightItemId}
              optionCode={line.optionCode}
              isAlternate={Boolean(line.alternateGroupId)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

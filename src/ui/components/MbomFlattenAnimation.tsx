import { isEbomOnlyGroup } from '../../domain/ebom';
import type { PlmBomLine, PlmItem } from '../../domain/types';

interface MbomFlattenAnimationProps {
  rootItemId: string;
  ebomLines: PlmBomLine[];
  items: PlmItem[];
  // false: E-BOM側のグループ構造で表示。true: M-BOM側のフラット化後の構造へアニメーション遷移する。
  flattened: boolean;
}

const ROW_ROOT_TOP = 10;
const ROW_MAIN_TOP = 48;
const ROW_GROUP_CHILD_TOP = 86;

function itemLabel(itemId: string, items: PlmItem[]): string {
  return items.find((i) => i.itemId === itemId)?.name ?? itemId;
}

function positionOf(list: PlmBomLine[], line: PlmBomLine, top: number): { left: string; top: string } {
  const idx = list.indexOf(line);
  const left = ((idx + 0.5) / list.length) * 100;
  return { left: `${left}%`, top: `${top}%` };
}

// 要件書10.3：脚部ユニットが消滅しフラット化される様子を、木製イスのオンボーディング
// ステップ3限定でCSSトランジションにより可視化する（design対象範囲外：自転車シナリオ・MbomTab本体）。
export function MbomFlattenAnimation({ rootItemId, ebomLines, items, flattened }: MbomFlattenAnimationProps) {
  const rootChildLines = ebomLines.filter((l) => l.parentItemId === rootItemId);
  const groupLine = rootChildLines.find((l) => isEbomOnlyGroup(l.childItemId, ebomLines));

  if (!groupLine) return null; // 表示対象のグループが無い構成では何も描画しない

  const plainSiblingLines = rootChildLines.filter((l) => l !== groupLine);
  const groupChildLines = ebomLines.filter((l) => l.parentItemId === groupLine.childItemId);
  const groupedMainRow = [...plainSiblingLines, groupLine];
  const flattenedMainRow = [...plainSiblingLines, ...groupChildLines];

  return (
    <div className={`mbom-flatten-diagram${flattened ? ' is-flattened' : ''}`} aria-hidden="true">
      <div
        className="mbom-flatten-diagram__node mbom-flatten-diagram__node--root"
        style={{ left: '50%', top: `${ROW_ROOT_TOP}%` }}
      >
        {itemLabel(rootItemId, items)}
      </div>

      {plainSiblingLines.map((line) => (
        <div
          key={line.bomLineId}
          className="mbom-flatten-diagram__node"
          style={positionOf(flattened ? flattenedMainRow : groupedMainRow, line, ROW_MAIN_TOP)}
        >
          {itemLabel(line.childItemId, items)}
        </div>
      ))}

      <div
        className="mbom-flatten-diagram__node mbom-flatten-diagram__node--group"
        style={{
          ...positionOf(groupedMainRow, groupLine, ROW_MAIN_TOP),
          opacity: flattened ? 0 : 1,
        }}
      >
        {itemLabel(groupLine.childItemId, items)}
        <span className="badge badge--ebom-only">E-BOM限定</span>
      </div>

      {groupChildLines.map((line) => (
        <div
          key={line.bomLineId}
          className="mbom-flatten-diagram__node mbom-flatten-diagram__node--child"
          style={positionOf(
            flattened ? flattenedMainRow : groupChildLines,
            line,
            flattened ? ROW_MAIN_TOP : ROW_GROUP_CHILD_TOP,
          )}
        >
          {itemLabel(line.childItemId, items)}
        </div>
      ))}
    </div>
  );
}

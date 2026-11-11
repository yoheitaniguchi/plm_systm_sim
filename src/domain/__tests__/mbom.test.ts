import { describe, expect, it } from 'vitest';
import { addEbomLine } from '../ebom';
import { checkInputOperations, checkMbomStaleness, convertEbomToMbom, resolveAlternates } from '../mbom';
import { firstOperationCodes } from '../operation';
import { createWoodenChairDemoState } from '../presets';
import type { PlmBomLine } from '../types';

function buildWoodenChairEbom(): PlmBomLine[] {
  const bomLines: PlmBomLine[] = [];
  addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(bomLines, { bomLineId: 'E-2', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(bomLines, { bomLineId: 'E-3', parentItemId: 'FG-100', childItemId: 'EU-450', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(bomLines, {
    bomLineId: 'E-4',
    parentItemId: 'EU-450',
    childItemId: 'PT-400',
    qtyPer: 4,
    effectiveFromDay: 0,
    isEbomOnly: true,
  });
  addEbomLine(bomLines, {
    bomLineId: 'E-5',
    parentItemId: 'EU-450',
    childItemId: 'PT-500',
    qtyPer: 8,
    effectiveFromDay: 0,
    isEbomOnly: true,
  });
  return bomLines;
}

// 親品目 → 既定の投入工程（親品目の最初の工程）。木製イス＝OP10 組立、座面ASSY＝OP10 切断（PLM-EXT-18）
const routingMap = firstOperationCodes(createWoodenChairDemoState().operations);

describe('mbom domain', () => {
  // UC-MBOM-1 / 4.1
  it('flattens the 脚部ユニット group away, re-parenting its children directly under FG-100', () => {
    const ebom = buildWoodenChairEbom();
    const mbom = convertEbomToMbom(ebom, routingMap, 5);

    // グループ自体（FG-100 -> EU-450）はM-BOMに出ない
    expect(mbom.some((l) => l.childItemId === 'EU-450')).toBe(false);

    const leg = mbom.find((l) => l.childItemId === 'PT-400');
    const screw = mbom.find((l) => l.childItemId === 'PT-500');
    expect(leg?.parentItemId).toBe('FG-100');
    expect(leg?.qtyPer).toBe(4);
    expect(screw?.parentItemId).toBe('FG-100');
    expect(screw?.qtyPer).toBe(8);
    expect(mbom.every((l) => l.bomType === 'M' && l.effectiveFromDay === 5)).toBe(true);
  });

  // UC-MBOM-2（design.md PLM-EXT-18で読み替え）：M-BOM行は「親品目のどの工程で投入するか」を持つ。
  // 座面ASSYの切断工程（WC-CUT）に対応づくのは、座面ASSYを親とする行（SA-200 → RM-300）
  it('sets the input operation of each M-BOM line to the first operation of its parent item', () => {
    const operations = createWoodenChairDemoState().operations;
    const ebom = buildWoodenChairEbom();
    const mbom = convertEbomToMbom(ebom, routingMap, 5);

    const boardLine = mbom.find((l) => l.parentItemId === 'SA-200' && l.childItemId === 'RM-300');
    expect(boardLine?.processStep).toBe('OP10');
    expect(operations.find((o) => o.itemId === 'SA-200' && o.opCode === boardLine?.processStep)).toMatchObject({
      name: '切断',
      workCenter: 'WC-CUT',
    });

    // 木製イスを親とする行（座面ASSY、フラット化された脚・ネジ）は、木製イスのOP10 組立で投入する
    for (const childItemId of ['SA-200', 'PT-400', 'PT-500']) {
      const line = mbom.find((l) => l.parentItemId === 'FG-100' && l.childItemId === childItemId);
      expect(line?.processStep).toBe('OP10');
    }
    expect(operations.find((o) => o.itemId === 'FG-100' && o.opCode === 'OP10')).toMatchObject({ name: '組立', workCenter: 'WC-ASM' });
    expect(checkInputOperations(mbom, operations)).toEqual([]);
  });

  it('leaves the input operation unassigned when the parent item has no operations', () => {
    const mbom = convertEbomToMbom(buildWoodenChairEbom(), {}, 5);
    expect(mbom.every((l) => l.processStep === undefined)).toBe(true);
    expect(checkInputOperations(mbom, []).every((i) => i.kind === '未割当')).toBe(true);
  });

  // UC-MBOM-3
  it('reports E-BOM lines that have not yet been reflected into the M-BOM (staleness)', () => {
    const ebom = buildWoodenChairEbom();
    const mbom = convertEbomToMbom(ebom, routingMap, 5);
    expect(checkMbomStaleness(ebom, mbom)).toHaveLength(0);

    // E-BOM側だけを改訂（M-BOM再変換はまだ）
    ebom.find((l) => l.bomLineId === 'E-1')!.effectiveToDay = 20;
    ebom.push({ ...ebom[0], bomLineId: 'E-1-v2', version: 2, qtyPer: 2, effectiveFromDay: 20, effectiveToDay: undefined });

    const warnings = checkMbomStaleness(ebom, mbom);
    expect(warnings.length).toBeGreaterThan(0);
  });

  // UC-VARIANT-3
  it('rejects M-BOM conversion while an option group is still unresolved', () => {
    const ebom = buildWoodenChairEbom();
    ebom.push({
      parentItemId: 'SA-200',
      childItemId: 'RM-301',
      qtyPer: 1,
      bomLineId: 'E-6',
      bomType: 'E',
      version: 1,
      effectiveFromDay: 0,
      optionGroupId: 'OG-SEAT-FINISH',
      optionCode: '布張り',
    });
    expect(() => convertEbomToMbom(ebom, routingMap, 5)).toThrow();
  });
});

function buildAlternateMbom(): PlmBomLine[] {
  return [
    { parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, bomLineId: 'M-1', bomType: 'M', version: 1, effectiveFromDay: 0 },
    {
      parentItemId: 'FG-100',
      childItemId: 'PT-400',
      qtyPer: 4,
      bomLineId: 'M-2',
      bomType: 'M',
      version: 1,
      effectiveFromDay: 0,
      alternateGroupId: 'AG-LEG',
      alternatePriority: 1,
      approvalStatus: '承認済',
    },
    {
      parentItemId: 'FG-100',
      childItemId: 'PT-401',
      qtyPer: 4,
      bomLineId: 'M-3',
      bomType: 'M',
      version: 1,
      effectiveFromDay: 0,
      alternateGroupId: 'AG-LEG',
      alternatePriority: 2,
      approvalStatus: '承認済',
    },
  ];
}

describe('resolveAlternates (4.5, 7.6)', () => {
  // UC-ALT-1
  it('defaults to the highest-priority approved alternate', () => {
    const resolved = resolveAlternates(buildAlternateMbom());
    expect(resolved.map((l) => l.childItemId)).toEqual(['SA-200', 'PT-400']);
  });

  // UC-ALT-2
  it('lets the user explicitly switch to another approved alternate without changing the product', () => {
    const resolved = resolveAlternates(buildAlternateMbom(), { 'AG-LEG': 'PT-401' });
    expect(resolved.map((l) => l.childItemId)).toEqual(['SA-200', 'PT-401']);
    expect(resolved.every((l) => l.parentItemId === 'FG-100')).toBe(true);
  });

  // UC-ALT-3
  it('rejects selecting an unapproved alternate', () => {
    const mbomLines = buildAlternateMbom();
    mbomLines[2].approvalStatus = '評価中';
    expect(() => resolveAlternates(mbomLines, { 'AG-LEG': 'PT-401' })).toThrow();
  });
});

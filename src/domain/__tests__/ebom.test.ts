import { describe, expect, it } from 'vitest';
import { addEbomLine, resolveConfiguration, reviseEbomLine, wouldCreateCycle } from '../ebom';
import type { Configuration, PlmBomLine } from '../types';

describe('ebom domain', () => {
  // UC-EBOM-1
  it('registers a new E-BOM line (incl. the 脚部ユニット functional group) at version 1', () => {
    const bomLines: PlmBomLine[] = [];
    addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });
    addEbomLine(bomLines, {
      bomLineId: 'E-2',
      parentItemId: 'FG-100',
      childItemId: 'EU-450',
      qtyPer: 1,
      effectiveFromDay: 0,
    });
    addEbomLine(bomLines, {
      bomLineId: 'E-3',
      parentItemId: 'EU-450',
      childItemId: 'PT-400',
      qtyPer: 4,
      effectiveFromDay: 0,
      isEbomOnly: true,
    });

    expect(bomLines).toHaveLength(3);
    expect(bomLines.every((l) => l.bomType === 'E' && l.version === 1)).toBe(true);
  });

  // UC-EBOM-2
  it('revises an E-BOM line: new version created, old version gets effectiveToDay', () => {
    const bomLines: PlmBomLine[] = [];
    addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });

    const revised = reviseEbomLine(bomLines, 'E-1', { qtyPer: 2 }, 'E-1-v2', 10);

    const original = bomLines.find((l) => l.bomLineId === 'E-1')!;
    expect(original.effectiveToDay).toBe(10);
    expect(revised.version).toBe(2);
    expect(revised.qtyPer).toBe(2);
    expect(revised.effectiveFromDay).toBe(10);
    expect(revised.effectiveToDay).toBeUndefined();
  });

  // UC-EBOM-3
  it('rejects registering a BOM line that would create a circular reference', () => {
    const bomLines: PlmBomLine[] = [];
    addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });
    addEbomLine(bomLines, { bomLineId: 'E-2', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, effectiveFromDay: 0 });

    // RM-300 -> FG-100 would close a cycle: FG-100 -> SA-200 -> RM-300 -> FG-100
    expect(wouldCreateCycle(bomLines, 'E', 'RM-300', 'FG-100')).toBe(true);
    expect(() =>
      addEbomLine(bomLines, { bomLineId: 'E-3', parentItemId: 'RM-300', childItemId: 'FG-100', qtyPer: 1, effectiveFromDay: 0 }),
    ).toThrow();
  });

  it('rejects a self-referencing BOM line', () => {
    const bomLines: PlmBomLine[] = [];
    expect(() =>
      addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'FG-100', qtyPer: 1, effectiveFromDay: 0 }),
    ).toThrow();
  });

  // UC-VARIANT-1
  it('resolveConfiguration keeps only the selected option and drops the rest', () => {
    const bomLines: PlmBomLine[] = [];
    addEbomLine(bomLines, { bomLineId: 'E-1', parentItemId: 'FG-100', childItemId: 'SA-200', qtyPer: 1, effectiveFromDay: 0 });
    addEbomLine(bomLines, {
      bomLineId: 'E-2',
      parentItemId: 'SA-200',
      childItemId: 'RM-300',
      qtyPer: 1,
      effectiveFromDay: 0,
      optionGroupId: 'OG-SEAT-FINISH',
      optionCode: '無垢材',
    });
    addEbomLine(bomLines, {
      bomLineId: 'E-3',
      parentItemId: 'SA-200',
      childItemId: 'RM-301',
      qtyPer: 1,
      effectiveFromDay: 0,
      optionGroupId: 'OG-SEAT-FINISH',
      optionCode: '布張り',
    });

    const configuration: Configuration = {
      configId: 'CFG-1',
      baseItemId: 'FG-100',
      selections: { 'OG-SEAT-FINISH': '布張り' },
      resolvedItemId: 'FG-101',
    };

    const resolved = resolveConfiguration(bomLines, configuration);
    const childIds = resolved.map((l) => l.childItemId);
    expect(childIds).toContain('RM-301');
    expect(childIds).not.toContain('RM-300');
    // トップレベル品目は確定後のresolvedItemIdへ差し替えられる
    expect(resolved.find((l) => l.childItemId === 'SA-200')?.parentItemId).toBe('FG-101');
  });
});

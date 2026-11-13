// E-BOM行の終了・子品目の置換と、由来の変更の記録のテスト（design.md PLM-EXT-21）。
import { describe, expect, it } from 'vitest';
import { addEbomLine, currentEbomLines, ebomLineBlockers, endEbomLine, replaceEbomChild, reviseEbomLine } from '../ebom';
import { isEffectiveAsOf } from '../impactAnalysis';
import { stripPlmOnlyBomFields } from '../masterSnapshot';
import { checkMbomStaleness, currentMbomLines } from '../mbom';
import { conveyorMasterSnapshot, createWoodenChairDemoState } from '../presets';
import { createInitialState, effectiveMbomLines, reducer } from '../reducer';
import type { AppState } from '../reducer';
import type { PlmBomLine } from '../types';

function driveLines(): PlmBomLine[] {
  const lines: PlmBomLine[] = [];
  addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'FG-800', childItemId: 'SA-820', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'SA-820', childItemId: 'PT-850', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(lines, { bomLineId: 'E-3', parentItemId: 'SA-820', childItemId: 'PT-860', qtyPer: 2, effectiveFromDay: 0 });
  return lines;
}

describe('endEbomLine', () => {
  it('closes the line from the given day without a successor, and keeps it in the history', () => {
    const lines = driveLines();
    const ended = endEbomLine(lines, 'E-3', 5);
    expect(ended.effectiveToDay).toBe(5);
    expect(lines).toHaveLength(3);
    expect(currentEbomLines(lines).map((l) => l.bomLineId)).toEqual(['E-1', 'E-2']);
    // 渡した日は「変更が効く日」：前日までは有効、その日から無効
    expect(isEffectiveAsOf(ended, 4)).toBe(true);
    expect(isEffectiveAsOf(ended, 5)).toBe(false);
  });

  it('rejects a day that is not after the start of the line, an invalid day, an ended line, and an unknown line', () => {
    const lines = driveLines();
    expect(() => endEbomLine(lines, 'E-3', 0)).toThrow(/有効開始日より後/);
    expect(() => endEbomLine(lines, 'E-3', -1)).toThrow(/0以上の整数/);
    expect(() => endEbomLine(lines, 'E-3', 1.5)).toThrow(/0以上の整数/);
    expect(() => endEbomLine(lines, 'E-3', Number.NaN)).toThrow(/0以上の整数/);
    expect(() => endEbomLine(lines, 'E-9', 3)).toThrow(/見つかりません/);
    endEbomLine(lines, 'E-3', 3);
    expect(() => endEbomLine(lines, 'E-3', 4)).toThrow(/旧版化/);
  });

  it('records the change that ended the line', () => {
    const lines = driveLines();
    expect(endEbomLine(lines, 'E-3', 5, 'ECR-1').endChangeId).toBe('ECR-1');
    expect(lines.find((l) => l.bomLineId === 'E-3')?.changeId).toBeUndefined();
  });
});

describe('replaceEbomChild', () => {
  it('ends the old line and adds a version-1 line for the new child with the same parent and quantity', () => {
    const lines = driveLines();
    const added = replaceEbomChild(lines, 'E-2', 'PT-851', 'E-4', 10, 'ECR-1');
    expect(added).toMatchObject({
      bomLineId: 'E-4',
      bomType: 'E',
      parentItemId: 'SA-820',
      childItemId: 'PT-851',
      qtyPer: 1,
      version: 1,
      effectiveFromDay: 10,
      changeId: 'ECR-1',
    });
    expect(added.effectiveToDay).toBeUndefined();
    const old = lines.find((l) => l.bomLineId === 'E-2')!;
    expect(old.effectiveToDay).toBe(10);
    expect(old.endChangeId).toBe('ECR-1');
    // 旧行と新しい行が同じ日に重ならない
    expect(lines.filter((l) => l.parentItemId === 'SA-820' && isEffectiveAsOf(l, 9)).map((l) => l.childItemId)).toEqual(['PT-850', 'PT-860']);
    expect(lines.filter((l) => l.parentItemId === 'SA-820' && isEffectiveAsOf(l, 10)).map((l) => l.childItemId)).toEqual(['PT-860', 'PT-851']);
  });

  it('keeps the option and E-BOM-only attributes of the replaced line', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, {
      bomLineId: 'E-1',
      parentItemId: 'SA-200',
      childItemId: 'RM-300',
      qtyPer: 1,
      effectiveFromDay: 0,
      optionGroupId: 'OG-SEAT',
      optionCode: '無垢材',
      isEbomOnly: true,
    });
    const added = replaceEbomChild(lines, 'E-1', 'RM-301', 'E-2', 3);
    expect(added).toMatchObject({ optionGroupId: 'OG-SEAT', optionCode: '無垢材', isEbomOnly: true, version: 1 });
    expect('changeId' in added).toBe(false);
  });

  it('rejects the same child, a child the parent already has, and a replacement that would create a cycle; nothing changes', () => {
    const lines = driveLines();
    const before = structuredClone(lines);
    expect(() => replaceEbomChild(lines, 'E-2', 'PT-850', 'E-4', 10)).toThrow(/今と同じ/);
    expect(() => replaceEbomChild(lines, 'E-2', 'PT-860', 'E-4', 10)).toThrow(/既に PT-860 を子に持っています/);
    expect(() => replaceEbomChild(lines, 'E-2', 'FG-800', 'E-4', 10)).toThrow(/循環参照/);
    expect(() => replaceEbomChild(lines, 'E-2', 'SA-820', 'E-4', 10)).toThrow(/循環参照/);
    expect(() => replaceEbomChild(lines, 'E-2', 'PT-851', 'E-4', 0)).toThrow(/有効開始日より後/);
    expect(lines).toEqual(before);
  });

  it('does not count the replaced line itself when checking for a cycle', () => {
    // A → B を A → C に置き換える。C → B があっても、A → B が無くなるので循環ではない
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'A', childItemId: 'B', qtyPer: 1, effectiveFromDay: 0 });
    addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'C', childItemId: 'B', qtyPer: 1, effectiveFromDay: 0 });
    expect(() => replaceEbomChild(lines, 'E-1', 'C', 'E-3', 2)).not.toThrow();
  });
});

describe('changeId on add and revise', () => {
  it('records the change on the new version only, and the old version records what ended it', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-820', childItemId: 'PT-860', qtyPer: 2, effectiveFromDay: 0, changeId: 'ECR-1' });
    const v2 = reviseEbomLine(lines, 'E-1', { qtyPer: 3 }, 'E-2', 4, 'ECR-2');
    expect(lines[0]).toMatchObject({ changeId: 'ECR-1', endChangeId: 'ECR-2', effectiveToDay: 4 });
    expect(v2.changeId).toBe('ECR-2');
    // 由来を指定しない改訂は、前の版の由来を持ち越さない
    const v3 = reviseEbomLine(lines, 'E-2', { qtyPer: 4 }, 'E-3', 6);
    expect('changeId' in v3).toBe(false);
    expect('endChangeId' in lines[1]).toBe(false);
  });

  it('is not written to the exported BOM line', () => {
    const lines: PlmBomLine[] = [];
    const line = addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-820', childItemId: 'PT-860', qtyPer: 2, effectiveFromDay: 0, changeId: 'ECR-1' });
    expect(stripPlmOnlyBomFields(line)).toEqual({ parentItemId: 'SA-820', childItemId: 'PT-860', qtyPer: 2 });
  });
});

describe('reducer: ebom/endLine and ebom/replaceChild (PLM-EXT-21)', () => {
  function conveyor(): AppState {
    let state = reducer(createInitialState(), { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    return reducer(state, { type: 'ui/advanceDay', byDays: 10 });
  }
  const ebomLine = (state: AppState, child: string) =>
    state.bomLines.find((l) => l.bomType === 'E' && l.childItemId === child && l.parentItemId === 'SA-820' && l.effectiveToDay === undefined)!;

  it('replaces the motor of the drive unit, and the M-BOM follows only after re-conversion', () => {
    let state = conveyor();
    state = reducer(state, {
      type: 'item/create',
      input: { itemId: 'PT-851', name: '新モーター', makeBuy: 'BUY', leadTimeDays: 5, purchasePrice: 16000, defaultSupplierId: 'SUP-1' },
    });
    expect(state.lastError).toBeNull();
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: ebomLine(state, 'PT-850').bomLineId, newChildItemId: 'PT-851', effectiveFromDay: 10 });
    expect(state.lastError).toBeNull();
    expect(currentEbomLines(state.bomLines).filter((l) => l.parentItemId === 'SA-820').map((l) => l.childItemId).sort()).toEqual(['PT-851', 'PT-860', 'PT-880']);
    // 行IDは既存の行と衝突しない
    expect(new Set(state.bomLines.map((l) => l.bomLineId)).size).toBe(state.bomLines.length);
    // 再変換するまで、M-BOMは古いまま（自動では再変換しない）
    expect(currentMbomLines(state.bomLines).some((l) => l.childItemId === 'PT-850')).toBe(true);
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 10 });
    expect(state.lastError).toBeNull();
    const mbom = currentMbomLines(state.bomLines).filter((l) => l.parentItemId === 'SA-820');
    expect(mbom.map((l) => l.childItemId).sort()).toEqual(['PT-851', 'PT-860', 'PT-880']);
    expect(mbom.every((l) => !('changeId' in l) && !('endChangeId' in l))).toBe(true);
  });

  it('ends a line, and re-conversion closes the matching M-BOM line', () => {
    let state = conveyor();
    state = reducer(state, { type: 'ebom/endLine', bomLineId: ebomLine(state, 'PT-860').bomLineId, effectiveFromDay: 10 });
    expect(state.lastError).toBeNull();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 10 });
    expect(currentMbomLines(state.bomLines).filter((l) => l.parentItemId === 'SA-820').map((l) => l.childItemId).sort()).toEqual(['PT-850', 'PT-880']);
  });

  it('rejects an unknown replacement item and an unknown change, leaving the BOM unchanged', () => {
    let state = conveyor();
    const before = state.bomLines;
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: ebomLine(state, 'PT-850').bomLineId, newChildItemId: 'PT-999', effectiveFromDay: 10 });
    expect(state.lastError).toMatch(/PT-999/);
    state = reducer(state, { type: 'ebom/endLine', bomLineId: ebomLine(state, 'PT-860').bomLineId, effectiveFromDay: 10, changeId: 'ECR-999' });
    expect(state.lastError).toMatch(/ECR-999/);
    expect(state.bomLines).toEqual(before);
  });

  it('accepts a registered change in any status as the origin of an edit', () => {
    let state = reducer(createWoodenChairDemoState(), { type: 'ui/advanceDay', byDays: 2 });
    state = reducer(state, {
      type: 'change/create',
      input: { changeId: 'ECR-T1', reason: 'コスト削減', changeLevel: '軽微', impactedItemIds: [], impactedBomLineIds: [] },
    });
    expect(state.lastError).toBeNull();
    const changeId = state.changes[0].changeId;
    const line = currentEbomLines(state.bomLines).find((l) => l.optionGroupId === undefined && l.isEbomOnly !== true)!;
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: line.bomLineId, patch: { qtyPer: line.qtyPer + 1 }, effectiveFromDay: 2, changeId });
    expect(state.lastError).toBeNull();
    expect(currentEbomLines(state.bomLines).find((l) => l.parentItemId === line.parentItemId && l.childItemId === line.childItemId)?.changeId).toBe(changeId);
  });
});

// ロジックレビューで見つかった経路（PLM-EXT-21）：E-BOM限定グループ・代替部品・未反映の警告
describe('end / replace around E-BOM-only groups, alternates and staleness (wooden chair)', () => {
  // 木製イス：E-1 FG-100→SA-200、E-4 FG-100→EU-450（脚部ユニット）、E-5/6/7 EU-450→PT-400/PT-500/PT-401
  // （E-5・E-7は代替部品グループ AG-LEG）
  const config = { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' };
  function chair(): AppState {
    let state = reducer(createWoodenChairDemoState(), { type: 'mbom/convert', effectiveFromDay: 0, configuration: config });
    expect(state.lastError).toBeNull();
    state = reducer(state, { type: 'ui/advanceDay', byDays: 3 });
    return state;
  }
  const staleness = (state: AppState) => checkMbomStaleness(state.bomLines, state.bomLines);

  it('refuses to end or replace the line to an E-BOM-only group', () => {
    let state = chair();
    const before = state.bomLines;
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-4', effectiveFromDay: 3 });
    expect(state.lastError).toMatch(/E-BOM限定グループ EU-450 への行/);
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: 'E-4', newChildItemId: 'PT-500', effectiveFromDay: 3 });
    expect(state.lastError).toMatch(/E-BOM限定グループ EU-450 への行/);
    expect(state.bomLines).toEqual(before);
  });

  it('refuses to end the last child of an E-BOM-only group, so the group never turns into an ordinary item', () => {
    let state = chair();
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-5', effectiveFromDay: 3 });
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-6', effectiveFromDay: 3 });
    expect(state.lastError).toBeNull();
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-7', effectiveFromDay: 3 });
    expect(state.lastError).toMatch(/最後の子は終了できません/);
    // 変換は壊れず、グループはM-BOMに出ない
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 3, configuration: config });
    expect(state.lastError).toBeNull();
    expect(currentMbomLines(state.bomLines).some((l) => l.childItemId === 'EU-450' || l.parentItemId === 'EU-450')).toBe(false);
  });

  it('refuses to replace a line of an alternate group', () => {
    let state = chair();
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: 'E-5', newChildItemId: 'PT-500', effectiveFromDay: 3 });
    expect(state.lastError).toMatch(/代替部品グループ AG-LEG/);
  });

  it('refuses a replacement that would duplicate a parent-child pair after the group is flattened', () => {
    // E-1（FG-100→SA-200）をPT-500に置き換えると、変換後は FG-100→PT-500 が脚部ユニットの分と重なる
    let state = chair();
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: 'E-1', newChildItemId: 'PT-500', effectiveFromDay: 3 });
    expect(state.lastError).toMatch(/既に PT-500 を子に持っています/);
  });

  it('warns that the M-BOM is stale after a line is ended, until re-conversion', () => {
    let state = chair();
    expect(staleness(state)).toEqual([]);
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-6', effectiveFromDay: 3 });
    expect(state.lastError).toBeNull();
    expect(staleness(state)).toHaveLength(1);
    expect(staleness(state)[0]).toMatch(/PT-500.*元のE-BOM行は終了/);
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 3, configuration: config });
    expect(staleness(state)).toEqual([]);
    expect(currentMbomLines(state.bomLines).some((l) => l.childItemId === 'PT-500')).toBe(false);
  });

  it('drops an alternate override whose line disappears on re-conversion, so the effective M-BOM still resolves', () => {
    let state = chair();
    state = reducer(state, { type: 'mbom/setAlternateOverride', alternateGroupId: 'AG-LEG', childItemId: 'PT-401' });
    expect(state.lastError).toBeNull();
    state = reducer(state, { type: 'ebom/endLine', bomLineId: 'E-7', effectiveFromDay: 3 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 3, configuration: config });
    expect(state.lastError).toBeNull();
    expect(state.alternateOverrides).toEqual({});
    expect(() => effectiveMbomLines(state)).not.toThrow();
    expect(effectiveMbomLines(state).filter((l) => l.alternateGroupId === 'AG-LEG').map((l) => l.childItemId)).toEqual(['PT-400']);
  });
});

describe('guards added to the existing revise, and M-BOM lines', () => {
  it('rejects M-BOM lines in revise, end and replace, and invalid days in revise', () => {
    const lines: PlmBomLine[] = [
      { bomLineId: 'M-1', bomType: 'M', parentItemId: 'A', childItemId: 'B', qtyPer: 1, version: 1, effectiveFromDay: 0 },
    ];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'A', childItemId: 'B', qtyPer: 1, effectiveFromDay: 0 });
    const before = structuredClone(lines);
    expect(() => reviseEbomLine(lines, 'M-1', { qtyPer: 2 }, 'X', 3, 'ECR-1')).toThrow(/E-BOM行ではありません/);
    expect(() => endEbomLine(lines, 'M-1', 3)).toThrow(/E-BOM行ではありません/);
    expect(() => replaceEbomChild(lines, 'M-1', 'C', 'X', 3)).toThrow(/E-BOM行ではありません/);
    expect(() => reviseEbomLine(lines, 'E-1', { qtyPer: 2 }, 'X', Number.NaN)).toThrow(/0以上の整数/);
    expect(() => reviseEbomLine(lines, 'E-1', { qtyPer: 2 }, 'X', 1.5)).toThrow(/0以上の整数/);
    expect(lines).toEqual(before);
  });

  it('allows a replacement to a child the parent has under another option code', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, effectiveFromDay: 0, optionGroupId: 'OG', optionCode: '無垢材' });
    addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'SA-200', childItemId: 'RM-301', qtyPer: 1, effectiveFromDay: 0, optionGroupId: 'OG', optionCode: '布張り' });
    expect(() => replaceEbomChild(lines, 'E-1', 'RM-301', 'E-3', 2)).not.toThrow();
  });
});

describe('ebomLineBlockers (PLM-EXT-23)', () => {
  it('tells the screen why a line cannot be changed today, ended or replaced', () => {
    const state = createWoodenChairDemoState();
    const line = (id: string) => state.bomLines.find((l) => l.bomLineId === id)!;
    // D0に始まった行は、D0には変更できない
    expect(ebomLineBlockers(state.bomLines, line('E-1'), 0).day).toMatch(/D1以降/);
    expect(ebomLineBlockers(state.bomLines, line('E-1'), 1)).toEqual({});
    // グループへの行は終了・置換とも不可、代替部品グループの行は置換不可
    expect(ebomLineBlockers(state.bomLines, line('E-4'), 1)).toEqual({ end: 'E-BOM限定グループへの行', replace: 'E-BOM限定グループへの行' });
    expect(ebomLineBlockers(state.bomLines, line('E-5'), 1)).toEqual({ replace: '代替部品グループの行' });
    expect(ebomLineBlockers(state.bomLines, line('E-6'), 1)).toEqual({});
    // グループの子が1つになると、その行は終了できない
    endEbomLine(state.bomLines, 'E-5', 1);
    endEbomLine(state.bomLines, 'E-7', 1);
    expect(ebomLineBlockers(state.bomLines, line('E-6'), 1)).toEqual({ end: 'グループの最後の子' });
  });
});

describe('reviseEbomLine (PLM-EXT-23)', () => {
  it('rejects a revision that changes nothing, and leaves the line current', () => {
    const lines = driveLines();
    expect(() => reviseEbomLine(lines, 'E-3', { qtyPer: 2 }, 'E-9', 3)).toThrow(/今の内容と同じです/);
    expect(lines.find((l) => l.bomLineId === 'E-3')?.effectiveToDay).toBeUndefined();
    expect(lines).toHaveLength(3);
  });
});

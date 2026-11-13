// 品目リビジョンの導出と差分のテスト（design.md PLM-EXT-22）。
import { describe, expect, it } from 'vitest';
import { addEbomLine, endEbomLine, replaceEbomChild, reviseEbomLine } from '../ebom';
import { conveyorMasterSnapshot, createWoodenChairDemoState } from '../presets';
import { createInitialState, reducer } from '../reducer';
import { deriveRevisions, diffRevisions, itemsWithRevisions, revisionLabel } from '../revision';
import type { PlmBomLine } from '../types';

// 駆動部 SA-820：モーター PT-850×1、歯車 PT-860×2、ボルト PT-880×4。親はコンベア装置 FG-800
function driveLines(): PlmBomLine[] {
  const lines: PlmBomLine[] = [];
  addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'FG-800', childItemId: 'SA-820', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'SA-820', childItemId: 'PT-850', qtyPer: 1, effectiveFromDay: 0 });
  addEbomLine(lines, { bomLineId: 'E-3', parentItemId: 'SA-820', childItemId: 'PT-860', qtyPer: 2, effectiveFromDay: 0 });
  addEbomLine(lines, { bomLineId: 'E-4', parentItemId: 'SA-820', childItemId: 'PT-880', qtyPer: 4, effectiveFromDay: 0 });
  return lines;
}

const children = (lines: PlmBomLine[]) => lines.map((l) => `${l.childItemId}×${l.qtyPer}`).sort();

describe('revisionLabel', () => {
  it('numbers revisions A, B ... Z, AA, AB', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(revisionLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('deriveRevisions', () => {
  it('gives a single revision A to an item whose lines never changed', () => {
    const revs = deriveRevisions('SA-820', driveLines(), 3);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ itemId: 'SA-820', rev: 'A', fromDay: 0, status: '有効', changeIds: [] });
    expect(revs[0].toDay).toBeUndefined();
    expect(children(revs[0].lines)).toEqual(['PT-850×1', 'PT-860×2', 'PT-880×4']);
  });

  it('returns no revision for an item that never had E-BOM children, and ignores M-BOM lines', () => {
    const lines = driveLines();
    lines.push({ bomLineId: 'M-1', bomType: 'M', parentItemId: 'PT-850', childItemId: 'X', qtyPer: 1, version: 1, effectiveFromDay: 0 });
    expect(deriveRevisions('PT-850', lines, 0)).toEqual([]);
    expect(itemsWithRevisions(lines)).toEqual(['FG-800', 'SA-820']);
  });

  it('starts revision B on the day the motor is replaced; the parent of the parent stays at A', () => {
    const lines = driveLines();
    replaceEbomChild(lines, 'E-2', 'PT-851', 'E-5', 10, 'ECR-1');
    const revs = deriveRevisions('SA-820', lines, 10);
    expect(revs.map((r) => [r.rev, r.fromDay, r.toDay, r.status])).toEqual([
      ['A', 0, 10, '旧版'],
      ['B', 10, undefined, '有効'],
    ]);
    expect(children(revs[0].lines)).toEqual(['PT-850×1', 'PT-860×2', 'PT-880×4']);
    expect(children(revs[1].lines)).toEqual(['PT-851×1', 'PT-860×2', 'PT-880×4']);
    expect(revs[1].changeIds).toEqual(['ECR-1']);
    // 親のコンベア装置は、自分の行が変わっていないのでAのまま
    expect(deriveRevisions('FG-800', lines, 10).map((r) => r.rev)).toEqual(['A']);
  });

  it('derives the status from the current day: 予定 before the start, 有効 within, 旧版 after', () => {
    const lines = driveLines();
    reviseEbomLine(lines, 'E-3', { qtyPer: 3 }, 'E-5', 10);
    const status = (day: number) => deriveRevisions('SA-820', lines, day).map((r) => r.status);
    expect(status(9)).toEqual(['有効', '予定']);
    expect(status(10)).toEqual(['旧版', '有効']);
    expect(status(20)).toEqual(['旧版', '有効']);
  });

  it('merges several changes on the same day into one revision', () => {
    const lines = driveLines();
    reviseEbomLine(lines, 'E-3', { qtyPer: 3 }, 'E-5', 10, 'ECR-1');
    endEbomLine(lines, 'E-4', 10, 'ECR-2');
    addEbomLine(lines, { bomLineId: 'E-6', parentItemId: 'SA-820', childItemId: 'PT-890', qtyPer: 1, effectiveFromDay: 10 });
    const revs = deriveRevisions('SA-820', lines, 10);
    expect(revs.map((r) => r.rev)).toEqual(['A', 'B']);
    expect(children(revs[1].lines)).toEqual(['PT-850×1', 'PT-860×3', 'PT-890×1']);
    expect(revs[1].changeIds).toEqual(['ECR-1', 'ECR-2']);
  });

  it('counts the period after every line was ended as a revision with no children', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-900', childItemId: 'PT-1', qtyPer: 1, effectiveFromDay: 0 });
    endEbomLine(lines, 'E-1', 4, 'ECR-9');
    const revs = deriveRevisions('SA-900', lines, 5);
    expect(revs.map((r) => [r.rev, r.fromDay, r.toDay, r.status, r.lines.length])).toEqual([
      ['A', 0, 4, '旧版', 1],
      ['B', 4, undefined, '有効', 0],
    ]);
    expect(revs[1].changeIds).toEqual(['ECR-9']);
  });

  it('starts the first revision on the day the first child was added, not on day 0', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-900', childItemId: 'PT-1', qtyPer: 1, effectiveFromDay: 3 });
    addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'SA-900', childItemId: 'PT-2', qtyPer: 1, effectiveFromDay: 6 });
    expect(deriveRevisions('SA-900', lines, 4).map((r) => [r.rev, r.fromDay, r.toDay, r.status])).toEqual([
      ['A', 3, 6, '有効'],
      ['B', 6, undefined, '予定'],
    ]);
  });

  it('treats an E-BOM-only group as an item of its own: its revision rises, its real parent stays', () => {
    let state = reducer(createWoodenChairDemoState(), { type: 'ui/advanceDay', byDays: 5 });
    const groupLine = state.bomLines.find((l) => l.bomType === 'E' && l.isEbomOnly && l.effectiveToDay === undefined)!;
    const groupId = groupLine.parentItemId;
    const realParent = state.bomLines.find((l) => l.bomType === 'E' && l.childItemId === groupId)!.parentItemId;
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: groupLine.bomLineId, patch: { qtyPer: groupLine.qtyPer + 1 }, effectiveFromDay: 5 });
    expect(state.lastError).toBeNull();
    expect(deriveRevisions(groupId, state.bomLines, 5).map((r) => r.rev)).toEqual(['A', 'B']);
    expect(deriveRevisions(realParent, state.bomLines, 5).map((r) => r.rev)).toEqual(['A']);
  });
});

describe('diffRevisions', () => {
  it('lists a replacement as one removal and one addition', () => {
    const lines = driveLines();
    replaceEbomChild(lines, 'E-2', 'PT-851', 'E-5', 10);
    const [a, b] = deriveRevisions('SA-820', lines, 10);
    expect(diffRevisions(a, b)).toEqual([
      { kind: '削除', childItemId: 'PT-850', qtyBefore: 1 },
      { kind: '追加', childItemId: 'PT-851', qtyAfter: 1 },
    ]);
  });

  it('lists a quantity change, an end and an addition; unchanged lines do not appear', () => {
    const lines = driveLines();
    reviseEbomLine(lines, 'E-3', { qtyPer: 3 }, 'E-5', 10);
    endEbomLine(lines, 'E-4', 10);
    addEbomLine(lines, { bomLineId: 'E-6', parentItemId: 'SA-820', childItemId: 'PT-890', qtyPer: 1, effectiveFromDay: 10 });
    const [a, b] = deriveRevisions('SA-820', lines, 10);
    expect(diffRevisions(a, b)).toEqual([
      { kind: '削除', childItemId: 'PT-880', qtyBefore: 4 },
      { kind: '数量変更', childItemId: 'PT-860', qtyBefore: 2, qtyAfter: 3 },
      { kind: '追加', childItemId: 'PT-890', qtyAfter: 1 },
    ]);
    // 逆向きに比べると、追加と削除が入れ替わる
    expect(diffRevisions(b, a).map((d) => [d.kind, d.childItemId])).toEqual([
      ['削除', 'PT-890'],
      ['数量変更', 'PT-860'],
      ['追加', 'PT-880'],
    ]);
  });

  it('can compare revisions that are not adjacent', () => {
    const lines = driveLines();
    reviseEbomLine(lines, 'E-3', { qtyPer: 3 }, 'E-5', 5);
    reviseEbomLine(lines, 'E-5', { qtyPer: 2 }, 'E-6', 8);
    const revs = deriveRevisions('SA-820', lines, 8);
    expect(revs.map((r) => r.rev)).toEqual(['A', 'B', 'C']);
    expect(diffRevisions(revs[0], revs[2])).toEqual([]);
    expect(diffRevisions(revs[0], revs[1])).toEqual([{ kind: '数量変更', childItemId: 'PT-860', qtyBefore: 2, qtyAfter: 3 }]);
  });

  it('shows no difference for a revision that changed something other than the quantity', () => {
    const lines = driveLines();
    reviseEbomLine(lines, 'E-3', { processStep: 'OP20' }, 'E-5', 5);
    const [a, b] = deriveRevisions('SA-820', lines, 5);
    expect(b.rev).toBe('B');
    expect(diffRevisions(a, b)).toEqual([]);
  });

  it('keys variant lines by child, option group and option code', () => {
    const lines: PlmBomLine[] = [];
    // 同じ子品目を、2つのオプショングループが同じオプションコードで持つ
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, effectiveFromDay: 0, optionGroupId: 'OG-A', optionCode: '標準' });
    addEbomLine(lines, { bomLineId: 'E-2', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 2, effectiveFromDay: 0, optionGroupId: 'OG-B', optionCode: '標準' });
    reviseEbomLine(lines, 'E-2', { qtyPer: 5 }, 'E-3', 4);
    const [a, b] = deriveRevisions('SA-200', lines, 4);
    expect(diffRevisions(a, b)).toEqual([
      { kind: '数量変更', childItemId: 'RM-300', optionGroupId: 'OG-B', optionCode: '標準', qtyBefore: 2, qtyAfter: 5 },
    ]);
  });

  it('shows a change of option code as a removal and an addition', () => {
    const lines: PlmBomLine[] = [];
    addEbomLine(lines, { bomLineId: 'E-1', parentItemId: 'SA-200', childItemId: 'RM-300', qtyPer: 1, effectiveFromDay: 0, optionGroupId: 'OG-A', optionCode: '無垢材' });
    reviseEbomLine(lines, 'E-1', { optionCode: '合板' }, 'E-2', 4);
    const [a, b] = deriveRevisions('SA-200', lines, 4);
    expect(diffRevisions(a, b)).toEqual([
      { kind: '削除', childItemId: 'RM-300', optionGroupId: 'OG-A', optionCode: '無垢材', qtyBefore: 1 },
      { kind: '追加', childItemId: 'RM-300', optionGroupId: 'OG-A', optionCode: '合板', qtyAfter: 1 },
    ]);
  });
});

describe('revisions through the reducer (conveyor)', () => {
  it('replacing the motor on day 10 gives the drive unit A → B with the expected difference', () => {
    let state = reducer(createInitialState(), { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
    state = reducer(state, { type: 'ui/advanceDay', byDays: 10 });
    state = reducer(state, {
      type: 'item/create',
      input: { itemId: 'PT-851', name: '新モーター', makeBuy: 'BUY', leadTimeDays: 5, purchasePrice: 16000, defaultSupplierId: 'SUP-1' },
    });
    const motor = state.bomLines.find((l) => l.bomType === 'E' && l.parentItemId === 'SA-820' && l.childItemId === 'PT-850')!;
    state = reducer(state, { type: 'ebom/replaceChild', bomLineId: motor.bomLineId, newChildItemId: 'PT-851', effectiveFromDay: 10 });
    expect(state.lastError).toBeNull();
    const revs = deriveRevisions('SA-820', state.bomLines, state.currentDay);
    expect(revs.map((r) => [r.rev, r.status])).toEqual([
      ['A', '旧版'],
      ['B', '有効'],
    ]);
    expect(diffRevisions(revs[0], revs[1])).toEqual([
      { kind: '削除', childItemId: 'PT-850', qtyBefore: 1 },
      { kind: '追加', childItemId: 'PT-851', qtyAfter: 1 },
    ]);
    expect(deriveRevisions('FG-800', state.bomLines, state.currentDay).map((r) => r.rev)).toEqual(['A']);
  });
});

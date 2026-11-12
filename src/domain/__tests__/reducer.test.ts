import { describe, expect, it } from 'vitest';
import { currentEbomLines, resolveConfiguration } from '../ebom';
import { buildPurchaseBom, computeCostImpact } from '../impactAnalysis';
import { checkInputOperations, checkMbomStaleness, convertEbomToMbom, currentMbomLines } from '../mbom';
import { currentOperations, firstOperationCodes } from '../operation';
import {
  bicycleMasterSnapshot,
  conveyorMasterSnapshot,
  createWoodenChairDemoState,
  woodenChairMasterSnapshot,
} from '../presets';
import { createInitialState, effectiveMbomLines, reducer } from '../reducer';
import type { AppState } from '../reducer';

describe('presets', () => {
  it('createWoodenChairDemoState seeds a self-consistent E-BOM (no thrown errors)', () => {
    const state = createWoodenChairDemoState();
    expect(state.items.map((i) => i.itemId)).toEqual(
      expect.arrayContaining(['FG-100', 'SA-200', 'RM-300', 'RM-301', 'PT-400', 'PT-401', 'PT-500']),
    );
  });

  // UC-VARIANT-3: 未解決の150%BOMのままではM-BOM変換できない
  it('refuses M-BOM conversion while the seat-finish option group is unresolved', () => {
    const state = createWoodenChairDemoState();
    expect(() => convertEbomToMbom(currentEbomLines(state.bomLines), firstOperationCodes(state.operations), 0)).toThrow();
  });

  // UC-MBOM-1 end-to-end: 「無垢材」を選んで確定した構成から変換する
  it('converts the resolved (無垢材) E-BOM to an M-BOM matching production_system_sim’s flat structure', () => {
    const state = createWoodenChairDemoState();
    const resolvedLines = resolveConfiguration(currentEbomLines(state.bomLines), {
      configId: 'CFG-DEFAULT',
      baseItemId: 'FG-100',
      selections: { 'OG-SEAT-FINISH': '無垢材' },
      resolvedItemId: 'FG-100',
    });
    const mbom = convertEbomToMbom(resolvedLines, firstOperationCodes(state.operations), 0);
    const flatPairs = mbom.map((l) => `${l.parentItemId}::${l.childItemId}`).sort();
    expect(flatPairs).toEqual(
      ['FG-100::PT-400', 'FG-100::PT-401', 'FG-100::PT-500', 'FG-100::SA-200', 'SA-200::RM-300'].sort(),
    );
  });
});

describe('reducer', () => {
  it('imports a MasterSnapshot via sync/import', () => {
    const state = reducer(createInitialState(), {
      type: 'sync/import',
      json: woodenChairMasterSnapshot,
      importedAtDay: 0,
    });
    expect(state.lastError).toBeNull();
    expect(state.items.map((i) => i.itemId)).toContain('FG-100');
    expect(state.syncSession).not.toBeNull();
  });

  it('surfaces domain errors on state.lastError without throwing', () => {
    const state = reducer(createInitialState(), {
      type: 'item/advanceLifecycle',
      itemId: 'DOES-NOT-EXIST',
      to: '設計確定',
    });
    expect(state.lastError).toMatch(/見つかりません/);
  });

  it('runs the full ECR→ECO→ECN→クローズ flow', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, {
      type: 'change/create',
      input: { changeId: 'ECR-100', reason: 'コスト削減', changeLevel: '軽微', impactedItemIds: ['FG-100'], impactedBomLineIds: [] },
    });
    state = reducer(state, { type: 'change/submitForReview', changeId: 'ECR-100' });
    state = reducer(state, {
      type: 'change/recordApproval',
      changeId: 'ECR-100',
      decision: { approverRole: '設計リーダー', decision: '承認' },
    });
    expect(state.changes[0].status).toBe('承認_影響分析中');

    state = reducer(state, { type: 'change/issueEco', changeId: 'ECR-100', effectiveFromDay: 30 });
    state = reducer(state, { type: 'change/notifyEcn', changeId: 'ECR-100' });
    state = reducer(state, { type: 'change/close', changeId: 'ECR-100' });

    expect(state.lastError).toBeNull();
    expect(state.changes[0].status).toBe('クローズ');
    expect(state.syncSession?.touchedItemIds.has('FG-100')).toBe(true);
  });

  // Issue #4: ECR起票時点のbeforeBomLinesスナップショットと、クローズ後の現在M-BOMとの
  // 原価差分をcomputeCostImpact()で確認できることをreducer経由のend-to-endで検証する
  it('captures a beforeBom snapshot at ECR creation and reflects the cost delta after switching to a cheaper alternate leg', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, {
      type: 'mbom/convert',
     
      effectiveFromDay: 0,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
    expect(state.lastError).toBeNull();

    state = reducer(state, {
      type: 'change/create',
      input: { changeId: 'ECR-200', reason: 'コスト削減', changeLevel: '軽微', impactedItemIds: ['FG-100'], impactedBomLineIds: [] },
    });
    const created = state.changes.find((c) => c.changeId === 'ECR-200')!;
    expect(created.beforeBomLines?.some((l) => l.childItemId === 'PT-400')).toBe(true);

    // PT-400（脚・標準、@250円）からPT-401（脚・代替品B、@220円）へ切り替える
    state = reducer(state, { type: 'mbom/setAlternateOverride', alternateGroupId: 'AG-LEG', childItemId: 'PT-401' });
    state = reducer(state, { type: 'change/submitForReview', changeId: 'ECR-200' });
    state = reducer(state, {
      type: 'change/recordApproval',
      changeId: 'ECR-200',
      decision: { approverRole: '設計リーダー', decision: '承認' },
    });
    state = reducer(state, { type: 'change/issueEco', changeId: 'ECR-200', effectiveFromDay: 10 });
    state = reducer(state, { type: 'change/notifyEcn', changeId: 'ECR-200' });
    state = reducer(state, { type: 'change/close', changeId: 'ECR-200' });
    expect(state.lastError).toBeNull();

    const closed = state.changes.find((c) => c.changeId === 'ECR-200')!;
    expect(closed.status).toBe('クローズ');
    const [impact] = computeCostImpact(closed, closed.beforeBomLines ?? [], effectiveMbomLines(state), state.items);
    // 脚は4本(qtyPer 4)使うので、差分は (250-220)*4 = 120円のコストダウン
    expect(impact.delta).toBe(-120);
  });

  // UC-VARIANT-1/2: 「布張り」を選ぶと新しい品目FG-101が確定し、そのM-BOMが得られる
  it('resolves the 布張り variant into a new item FG-101 and converts its own M-BOM', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, {
      type: 'variant/resolveConfiguration',
      baseItemId: 'FG-100',
      selections: { 'OG-SEAT-FINISH': '布張り' },
      resolvedItemId: 'FG-101',
      resolvedItemName: '木製イス〈布張り〉',
    });
    expect(state.lastError).toBeNull();
    expect(state.items.some((i) => i.itemId === 'FG-101')).toBe(true);

    state = reducer(state, {
      type: 'mbom/convert',
     
      effectiveFromDay: 0,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '布張り' }, resolvedItemId: 'FG-101' },
    });
    expect(state.lastError).toBeNull();

    const newLines = state.bomLines.filter((l) => l.bomType === 'M' && l.bomLineId.endsWith('-FG-101'));
    const pairs = newLines.map((l) => `${l.parentItemId}::${l.childItemId}`).sort();
    expect(pairs).toEqual(
      ['FG-101::SA-200', 'FG-101::PT-400', 'FG-101::PT-401', 'FG-101::PT-500', 'SA-200::RM-301'].sort(),
    );
    expect(newLines.some((l) => l.childItemId === 'RM-300')).toBe(false);
  });

  it('rejects an unapproved alternate override (UC-ALT-3) via mbom/setAlternateOverride', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, {
      type: 'mbom/convert',
     
      effectiveFromDay: 0,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
    expect(state.lastError).toBeNull();
    // PT-401を評価中に落とす
    const line = state.bomLines.find((l) => l.bomType === 'M' && l.childItemId === 'PT-401');
    if (line) line.approvalStatus = '評価中';
    state = reducer(state, { type: 'mbom/setAlternateOverride', alternateGroupId: 'AG-LEG', childItemId: 'PT-401' });
    expect(state.lastError).toBeTruthy();
  });

  it('runs the sync preflight round trip: clean → export → new baseline', () => {
    let state: AppState = reducer(createInitialState(), {
      type: 'sync/import',
      json: woodenChairMasterSnapshot,
      importedAtDay: 0,
    });
    state = reducer(state, {
      type: 'change/create',
      input: { changeId: 'ECR-1', reason: '品質・安全', changeLevel: '軽微', impactedItemIds: ['PT-400'], impactedBomLineIds: [] },
    });
    state = reducer(state, { type: 'change/submitForReview', changeId: 'ECR-1' });
    state = reducer(state, {
      type: 'change/recordApproval',
      changeId: 'ECR-1',
      decision: { approverRole: '設計リーダー', decision: '承認' },
    });
    state = reducer(state, { type: 'change/issueEco', changeId: 'ECR-1', effectiveFromDay: 5 });
    state = reducer(state, { type: 'change/notifyEcn', changeId: 'ECR-1' });
    state = reducer(state, { type: 'change/close', changeId: 'ECR-1' });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 5 });

    state = reducer(state, { type: 'sync/preflight', currentJson: woodenChairMasterSnapshot });
    expect(state.lastError).toBeNull();
    expect(state.exportPreflight?.status).toBe('clean');

    state = reducer(state, { type: 'sync/confirmExport', sourceChangeId: 'ECR-1' });
    expect(state.lastError).toBeNull();
    expect(state.syncEvents).toHaveLength(1);
    expect(state.syncSession?.touchedItemIds.size).toBe(0);
  });

  it('blocks export while a conflict is unresolved, then unblocks after resolution (UC-SYNC-8)', () => {
    let state: AppState = reducer(createInitialState(), {
      type: 'sync/import',
      json: woodenChairMasterSnapshot,
      importedAtDay: 0,
    });
    state = reducer(state, {
      type: 'item/update',
      itemId: 'PT-400',
      patch: { purchasePrice: 240 },
    });
    if (state.syncSession) state.syncSession.touchedItemIds.add('PT-400');

    const theirEdit = structuredClone(woodenChairMasterSnapshot);
    theirEdit.items.find((i) => i.itemId === 'PT-400')!.purchasePrice = 260;

    state = reducer(state, { type: 'sync/preflight', currentJson: theirEdit });
    expect(state.exportPreflight?.status).toBe('conflict');

    state = reducer(state, {
      type: 'sync/resolveConflict',
      kind: 'item',
      key: 'PT-400',
      resolution: 'ours',
    });
    expect(state.exportPreflight?.status).not.toBe('conflict');
  });

  it('loads the bicycle preset for the applied 4-level BOM scenario', () => {
    const state = reducer(createInitialState(), {
      type: 'sync/import',
      json: bicycleMasterSnapshot,
      importedAtDay: 0,
    });
    expect(state.lastError).toBeNull();
    expect(currentEbomLines(state.bomLines)).toHaveLength(4);
  });
});

// Issue #15 / PLM-EXT-16: M-BOMの再変換で行が重複しない
describe('mbom/convert re-conversion (PLM-EXT-16)', () => {
  const chairConfig = (finish: string, resolvedItemId: string) => ({
    baseItemId: 'FG-100',
    selections: { 'OG-SEAT-FINISH': finish },
    resolvedItemId,
  });
  const currentM = (state: AppState) => state.bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay === undefined);
  const ids = (lines: { bomLineId: string }[]) => lines.map((l) => l.bomLineId);

  function importConveyorAndConvert(): AppState {
    let state = reducer(createInitialState(), { type: 'sync/import', json: conveyorMasterSnapshot, importedAtDay: 0 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    return state;
  }

  it('is idempotent: converting twice without any E-BOM change adds no lines', () => {
    const once = importConveyorAndConvert();
    const twice = reducer(once, { type: 'mbom/convert', effectiveFromDay: 0 });
    expect(twice.lastError).toBeNull();
    expect(twice.bomLines.filter((l) => l.bomType === 'M')).toHaveLength(10);
    expect(twice.bomLines.filter((l) => l.bomType === 'M')).toEqual(once.bomLines.filter((l) => l.bomType === 'M'));
  });

  it('closes the superseded M-BOM line and adds only the revised one after an E-BOM revision', () => {
    let state = importConveyorAndConvert();
    const motorLine = state.bomLines.find((l) => l.bomType === 'E' && l.childItemId === 'PT-850')!;
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: motorLine.bomLineId, patch: { qtyPer: 2 }, effectiveFromDay: 5 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 5 });
    expect(state.lastError).toBeNull();

    const current = currentM(state);
    expect(current).toHaveLength(10);
    expect(new Set(ids(current)).size).toBe(10);
    const motor = current.filter((l) => l.childItemId === 'PT-850');
    expect(motor).toHaveLength(1);
    expect(motor[0]).toMatchObject({ qtyPer: 2, version: 2, effectiveFromDay: 5 });

    // 旧版は消さずに残す（履歴）。旧版化した日＝再変換の有効開始日
    const closed = state.bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay !== undefined);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ childItemId: 'PT-850', qtyPer: 1, effectiveFromDay: 0, effectiveToDay: 5 });

    expect(checkMbomStaleness(state.bomLines, state.bomLines)).toEqual([]);
    expect(buildPurchaseBom('FG-800', currentM(state), state.items, 5).find((p) => p.itemId === 'PT-850')?.totalQtyPer).toBe(2);
    // 旧版化前の日付で見れば、旧版の数量のまま
    expect(buildPurchaseBom('FG-800', state.bomLines.filter((l) => l.bomType === 'M'), state.items, 4).find((p) => p.itemId === 'PT-850')?.totalQtyPer).toBe(1);
  });

  it('rejects a re-conversion dated before the line it would supersede', () => {
    let state = importConveyorAndConvert();
    state = reducer(state, { type: 'ui/advanceDay', byDays: 3 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 3 });
    const motorLine = state.bomLines.find((l) => l.bomType === 'E' && l.childItemId === 'PT-850')!;
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: motorLine.bomLineId, patch: { qtyPer: 2 }, effectiveFromDay: 5 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 5 });
    const before = state.bomLines.filter((l) => l.bomType === 'M');
    const motorE = state.bomLines.find((l) => l.bomType === 'E' && l.childItemId === 'PT-850' && l.effectiveToDay === undefined)!;
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: motorE.bomLineId, patch: { qtyPer: 3 }, effectiveFromDay: 8 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 4 });
    expect(state.lastError).toMatch(/有効開始日/);
    expect(state.bomLines.filter((l) => l.bomType === 'M')).toEqual(before);
  });

  it('fills the input operation of unassigned lines on re-conversion, without adding lines', () => {
    // 工順が空のスナップショットを取り込むと、最初の変換では投入工程が未割当になる
    let state = reducer(createInitialState(), { type: 'sync/import', json: { ...conveyorMasterSnapshot, routingSteps: [] }, importedAtDay: 0 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    expect(currentM(state).every((l) => l.processStep === undefined)).toBe(true);
    state = reducer(state, { type: 'operation/add', input: { itemId: 'SA-820', name: '組立', workCenter: 'WC-ASM', stdTimeMin: 45, effectiveFromDay: 0 } });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    const current = currentM(state);
    expect(current).toHaveLength(10);
    expect(current.filter((l) => l.parentItemId === 'SA-820').every((l) => l.processStep === 'OP10')).toBe(true);
    expect(current.filter((l) => l.parentItemId !== 'SA-820').every((l) => l.processStep === undefined)).toBe(true);
  });

  it('is idempotent for the onboarding conversion of the wooden chair (same configuration twice)', () => {
    let state = createWoodenChairDemoState();
    const convert = { type: 'mbom/convert' as const, effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') };
    state = reducer(state, convert);
    const first = state.bomLines.filter((l) => l.bomType === 'M');
    state = reducer(state, convert);
    expect(state.lastError).toBeNull();
    expect(state.bomLines.filter((l) => l.bomType === 'M')).toEqual(first);
  });

  it('keeps conversions of different resolved items apart (FG-100 and FG-101 do not close each other)', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    const fg100 = ids(currentM(state)).sort();
    state = reducer(state, {
      type: 'variant/resolveConfiguration',
      baseItemId: 'FG-100',
      selections: { 'OG-SEAT-FINISH': '布張り' },
      resolvedItemId: 'FG-101',
      resolvedItemName: '木製イス〈布張り〉',
    });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('布張り', 'FG-101') });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('布張り', 'FG-101') });
    expect(state.lastError).toBeNull();
    const current = currentM(state);
    expect(ids(current).filter((id) => id.endsWith('-FG-100')).sort()).toEqual(fg100);
    expect(current.filter((l) => l.bomLineId.endsWith('-FG-101'))).toHaveLength(5);
    expect(state.bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay !== undefined)).toEqual([]);
  });

  it('closes the previous option line when the same resolved item is re-converted with another selection', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('布張り', 'FG-100') });
    expect(state.lastError).toBeNull();
    const seatChildren = currentM(state).filter((l) => l.parentItemId === 'SA-200').map((l) => l.childItemId);
    expect(seatChildren).toEqual(['RM-301']);
  });

  // 確定品目コードが別の品目コードを末尾に含んでいても、変換範囲を取り違えない
  it('does not confuse scopes when one resolved item code ends with another (FG-100 vs DX-FG-100)', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    state = reducer(state, {
      type: 'variant/resolveConfiguration',
      baseItemId: 'FG-100',
      selections: { 'OG-SEAT-FINISH': '布張り' },
      resolvedItemId: 'DX-FG-100',
      resolvedItemName: '木製イス〈デラックス〉',
    });
    const dx = { type: 'mbom/convert' as const, effectiveFromDay: 0, configuration: chairConfig('布張り', 'DX-FG-100') };
    state = reducer(state, dx);
    state = reducer(state, dx);
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    expect(state.lastError).toBeNull();
    const current = currentM(state);
    expect(new Set(ids(current)).size).toBe(current.length);
    expect(current.filter((l) => l.mbomScope === 'DX-FG-100')).toHaveLength(5);
    expect(current.filter((l) => l.mbomScope === 'FG-100')).toHaveLength(5);
    expect(state.bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay !== undefined)).toEqual([]);
  });

  it('leaves FG-101 untouched when FG-100 is re-converted with another selection, and records the closing day', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    state = reducer(state, { type: 'variant/resolveConfiguration', baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '布張り' }, resolvedItemId: 'FG-101', resolvedItemName: '木製イス〈布張り〉' });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('布張り', 'FG-101') });
    const fg101 = state.bomLines.filter((l) => l.mbomScope === 'FG-101');
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 7, configuration: chairConfig('布張り', 'FG-100') });
    expect(state.lastError).toBeNull();
    expect(state.bomLines.filter((l) => l.mbomScope === 'FG-101')).toEqual(fg101);
    const closed = state.bomLines.filter((l) => l.bomType === 'M' && l.effectiveToDay !== undefined);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ childItemId: 'RM-300', mbomScope: 'FG-100', effectiveToDay: 7 });
    // 変わらなかった行は有効開始日も版もそのまま
    expect(currentM(state).find((l) => l.mbomScope === 'FG-100' && l.childItemId === 'PT-500')).toMatchObject({ effectiveFromDay: 0, version: 1 });
  });

  // 木製イスのプリセット行ID（E-1〜E-7）と、改訂で発番するIDが衝突しない
  it('keeps both alternate legs after revising a preset E-BOM line and re-converting the wooden chair', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: 'E-5', patch: { qtyPer: 3 }, effectiveFromDay: 5 });
    expect(state.lastError).toBeNull();
    const eIds = ids(state.bomLines.filter((l) => l.bomType === 'E'));
    expect(new Set(eIds).size).toBe(eIds.length);
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 5, configuration: chairConfig('無垢材', 'FG-100') });
    expect(state.lastError).toBeNull();
    const current = currentM(state);
    expect(current.map((l) => `${l.childItemId}×${l.qtyPer}`).sort()).toEqual(['PT-400×3', 'PT-401×4', 'PT-500×8', 'RM-300×1', 'SA-200×1']);
    expect(effectiveMbomLines(state).filter((l) => l.alternateGroupId === 'AG-LEG').map((l) => l.childItemId)).toEqual(['PT-400']);
  });

  it('rejects conversion when two source E-BOM lines share an id instead of silently dropping one', () => {
    const state = createWoodenChairDemoState();
    state.bomLines.find((l) => l.bomLineId === 'E-6')!.bomLineId = 'E-5';
    const next = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: chairConfig('無垢材', 'FG-100') });
    expect(next.lastError).toMatch(/重複/);
    expect(next.bomLines.filter((l) => l.bomType === 'M')).toEqual([]);
  });

  // 同じ確定品目でオプションを往復させると、旧版と現行に同じ行IDが並ぶ。競合解決は現行行だけを書き換える
  it('applies a "theirs" conflict resolution to the current M-BOM line, not to a closed one with the same id', () => {
    let state = reducer(createInitialState(), { type: 'sync/import', json: woodenChairMasterSnapshot, importedAtDay: 0 });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0 });
    const seat = state.bomLines.find((l) => l.bomType === 'M' && l.childItemId === 'RM-300')!;
    // 旧版と現行に同じIDが並ぶ状態を作る
    state.bomLines.unshift({ ...seat, effectiveToDay: 0 });
    state.syncSession!.touchedBomKeys.add('SA-200::RM-300');
    const theirs = structuredClone(woodenChairMasterSnapshot);
    theirs.bom.find((l) => l.parentItemId === 'SA-200' && l.childItemId === 'RM-300')!.qtyPer = 2;
    state = reducer(state, { type: 'sync/preflight', currentJson: theirs });
    expect(state.exportPreflight?.status).toBe('conflict');
    state = reducer(state, { type: 'sync/resolveConflict', kind: 'bomLine', key: 'SA-200::RM-300', resolution: 'theirs' });
    const lines = state.bomLines.filter((l) => l.bomType === 'M' && l.childItemId === 'RM-300');
    expect(lines.find((l) => l.effectiveToDay === undefined)?.qtyPer).toBe(2);
    expect(lines.find((l) => l.effectiveToDay !== undefined)?.qtyPer).toBe(1);
  });
});

describe('input operation of M-BOM lines (PLM-EXT-18)', () => {
  function convertedChair(): AppState {
    return reducer(createWoodenChairDemoState(), {
      type: 'mbom/convert',
      effectiveFromDay: 0,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
  }
  const lineOf = (state: AppState, parent: string, child: string) =>
    currentMbomLines(state.bomLines).find((l) => l.parentItemId === parent && l.childItemId === child)!;

  it('defaults every line of the converted wooden chair to the first operation of its parent', () => {
    const state = convertedChair();
    expect(state.lastError).toBeNull();
    expect(currentMbomLines(state.bomLines).map((l) => `${l.parentItemId}>${l.childItemId}:${l.processStep}`).sort()).toEqual([
      'FG-100>PT-400:OP10',
      'FG-100>PT-401:OP10',
      'FG-100>PT-500:OP10',
      'FG-100>SA-200:OP10',
      'SA-200>RM-300:OP10',
    ]);
    expect(checkInputOperations(state.bomLines, state.operations)).toEqual([]);
  });

  it('assigns another operation of the parent item in place, and keeps it across re-conversion', () => {
    let state = convertedChair();
    const screw = lineOf(state, 'FG-100', 'PT-500');
    state = reducer(state, { type: 'mbom/assignOperation', bomLineId: screw.bomLineId, opCode: 'OP20' });
    expect(state.lastError).toBeNull();
    const assigned = lineOf(state, 'FG-100', 'PT-500');
    expect(assigned).toMatchObject({ processStep: 'OP20', version: screw.version, bomLineId: screw.bomLineId });

    state = reducer(state, {
      type: 'mbom/convert',
      effectiveFromDay: 3,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
    expect(lineOf(state, 'FG-100', 'PT-500').processStep).toBe('OP20');
    expect(currentMbomLines(state.bomLines)).toHaveLength(5);
  });

  it('carries the assignment over when the source E-BOM line is revised and re-converted', () => {
    let state = convertedChair();
    const leg = lineOf(state, 'FG-100', 'PT-400');
    state = reducer(state, { type: 'mbom/assignOperation', bomLineId: leg.bomLineId, opCode: 'OP20' });
    state = reducer(state, { type: 'ebom/reviseLine', bomLineId: 'E-5', patch: { qtyPer: 3 }, effectiveFromDay: 5 });
    state = reducer(state, {
      type: 'mbom/convert',
      effectiveFromDay: 5,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
    expect(state.lastError).toBeNull();
    const revised = lineOf(state, 'FG-100', 'PT-400');
    expect(revised.bomLineId).not.toBe(leg.bomLineId);
    expect(revised).toMatchObject({ qtyPer: 3, processStep: 'OP20' });
  });

  it('refills an explicitly cleared assignment with the default on re-conversion', () => {
    let state = convertedChair();
    state = reducer(state, { type: 'mbom/assignOperation', bomLineId: lineOf(state, 'FG-100', 'PT-500').bomLineId });
    state = reducer(state, {
      type: 'mbom/convert',
      effectiveFromDay: 0,
      configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
    });
    expect(lineOf(state, 'FG-100', 'PT-500').processStep).toBe('OP10');
  });

  it('refuses to end an operation used only by an alternate line that is not currently selected', () => {
    let state = convertedChair();
    for (const child of ['SA-200', 'PT-400', 'PT-500']) {
      state = reducer(state, { type: 'mbom/assignOperation', bomLineId: lineOf(state, 'FG-100', child).bomLineId, opCode: 'OP20' });
    }
    // 代替品B（PT-401）は既定では選ばれていないが、現行のM-BOM行としてOP10を指している
    const assembly = currentOperations(state.operations, 'FG-100')[0];
    const refused = reducer(state, { type: 'operation/end', operationId: assembly.operationId, effectiveToDay: 1 });
    expect(refused.lastError).toContain('PT-401');
  });

  it('reports an assignment that points at an operation of another item as invalid', () => {
    const state = convertedChair();
    const lines = structuredClone(state.bomLines);
    lines.find((l) => l.bomType === 'M' && l.childItemId === 'RM-300')!.processStep = 'OP20';
    expect(checkInputOperations(lines, state.operations)).toEqual([
      expect.objectContaining({ parentItemId: 'SA-200', childItemId: 'RM-300', kind: '無効', processStep: 'OP20' }),
    ]);
  });

  it('rejects an operation that is not a current operation of the parent item', () => {
    const state = convertedChair();
    const board = lineOf(state, 'SA-200', 'RM-300');
    // OP20（検査）は木製イスの工程で、座面ASSYの工程ではない
    const wrongItem = reducer(state, { type: 'mbom/assignOperation', bomLineId: board.bomLineId, opCode: 'OP20' });
    expect(wrongItem.lastError).toContain('SA-200');
    expect(wrongItem.bomLines).toEqual(state.bomLines);
    const unknownLine = reducer(state, { type: 'mbom/assignOperation', bomLineId: 'M-NONE', opCode: 'OP10' });
    expect(unknownLine.lastError).toContain('M-NONE');
  });

  it('can clear an assignment, which is then reported as unassigned', () => {
    let state = convertedChair();
    const board = lineOf(state, 'SA-200', 'RM-300');
    state = reducer(state, { type: 'mbom/assignOperation', bomLineId: board.bomLineId });
    expect(checkInputOperations(state.bomLines, state.operations)).toEqual([
      { bomLineId: board.bomLineId, parentItemId: 'SA-200', childItemId: 'RM-300', kind: '未割当' },
    ]);
  });

  it('refuses to end an operation that M-BOM lines use, until they are reassigned', () => {
    let state = convertedChair();
    const assembly = currentOperations(state.operations, 'FG-100')[0];
    const refused = reducer(state, { type: 'operation/end', operationId: assembly.operationId, effectiveToDay: 1 });
    expect(refused.lastError).toContain('投入工程のため終了できません');
    expect(refused.operations).toEqual(state.operations);

    for (const line of currentMbomLines(state.bomLines).filter((l) => l.parentItemId === 'FG-100')) {
      state = reducer(state, { type: 'mbom/assignOperation', bomLineId: line.bomLineId, opCode: 'OP20' });
    }
    state = reducer(state, { type: 'operation/end', operationId: assembly.operationId, effectiveToDay: 1 });
    expect(state.lastError).toBeNull();
    expect(currentOperations(state.operations, 'FG-100').map((o) => o.opCode)).toEqual(['OP20']);
    expect(checkInputOperations(state.bomLines, state.operations)).toEqual([]);
  });

  it('keeps assignments valid when the operation is revised or reordered (the code does not change)', () => {
    let state = convertedChair();
    const assembly = currentOperations(state.operations, 'FG-100')[0];
    state = reducer(state, { type: 'operation/revise', operationId: assembly.operationId, patch: { stdTimeMin: 25 }, effectiveFromDay: 2 });
    state = reducer(state, { type: 'operation/reorder', itemId: 'FG-100', opCodesInOrder: ['OP20', 'OP10'], effectiveFromDay: 3 });
    expect(state.lastError).toBeNull();
    expect(checkInputOperations(state.bomLines, state.operations)).toEqual([]);
  });

  it('reports lines of a variant item without operations as unassigned', () => {
    let state = createWoodenChairDemoState();
    state = reducer(state, { type: 'variant/resolveConfiguration', baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '布張り' }, resolvedItemId: 'FG-101', resolvedItemName: '木製イス（布張り）' });
    state = reducer(state, { type: 'mbom/convert', effectiveFromDay: 0, configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '布張り' }, resolvedItemId: 'FG-101' } });
    const issues = checkInputOperations(state.bomLines, state.operations);
    // FG-101は新しい品目で工程が無いため、FG-101を親とする行は未割当。座面ASSYを親とする行は割り当て済み
    expect(issues.every((i) => i.parentItemId === 'FG-101' && i.kind === '未割当')).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { currentEbomLines, resolveConfiguration } from '../ebom';
import { computeCostImpact } from '../impactAnalysis';
import { convertEbomToMbom } from '../mbom';
import {
  bicycleMasterSnapshot,
  createWoodenChairDemoState,
  woodenChairMasterSnapshot,
  woodenChairRoutingMap,
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
    expect(() => convertEbomToMbom(currentEbomLines(state.bomLines), woodenChairRoutingMap, 0)).toThrow();
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
    const mbom = convertEbomToMbom(resolvedLines, woodenChairRoutingMap, 0);
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
      routingMap: woodenChairRoutingMap,
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
      routingMap: woodenChairRoutingMap,
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
      routingMap: woodenChairRoutingMap,
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
    state = reducer(state, { type: 'mbom/convert', routingMap: woodenChairRoutingMap, effectiveFromDay: 5 });

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

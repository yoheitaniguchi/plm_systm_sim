// 全ドメインを束ねるreducer（2章）。
// useReducerと組み合わせて使う。structuredCloneした状態を各ドメインモジュールへ渡し、
// モジュール側が直接書き換える（呼び出し側からは純粋関数として扱える）。
import * as changeManagement from './changeManagement';
import * as document from './document';
import * as ebom from './ebom';
import * as item from './item';
import * as masterSnapshot from './masterSnapshot';
import * as mbom from './mbom';
import * as operation from './operation';
import * as resource from './resource';
import type {
  ApproverDecision,
  ChangeReason,
  Configuration,
  DesignDocument,
  EngineeringChange,
  ExportPreflightResult,
  ItemCodePrefix,
  ItemLifecycleStatus,
  MasterSnapshot,
  Operation,
  OperationResource,
  Passthrough,
  PlmBomLine,
  PlmItem,
  SyncEvent,
  SyncSession,
} from './types';

export interface AppState {
  currentDay: number;
  items: PlmItem[];
  bomLines: PlmBomLine[]; // E-BOM・M-BOM混在。bomTypeで区別する
  changes: EngineeringChange[];
  documents: DesignDocument[];
  configurations: Configuration[];
  operations: Operation[]; // 工程（BOP）。全品目・全版が混在。現在有効な工程が工順として書き出される（PLM-EXT-17）
  operationResources: OperationResource[]; // 資源（BOR）。PLM独自で書き出さない。版管理なし（PLM-EXT-19）
  passthrough: Passthrough;
  alternateOverrides: Record<string, string>; // alternateGroupId -> childItemId（4.5・7.6）
  syncSession: SyncSession | null;
  syncEvents: SyncEvent[];
  exportPreflight: ExportPreflightResult | null;
  pendingCurrentSnapshot: MasterSnapshot | null; // preflight時に取得したproduction_system_sim側の最新
  lastError: string | null;
  lastWarning: string | null;
  idCounter: number;
}

export function createInitialState(): AppState {
  return {
    currentDay: 0,
    items: [],
    bomLines: [],
    changes: [],
    documents: [],
    configurations: [],
    operations: [],
    operationResources: [],
    passthrough: { workCenters: [], customers: [], suppliers: [] },
    alternateOverrides: {},
    syncSession: null,
    syncEvents: [],
    exportPreflight: null,
    pendingCurrentSnapshot: null,
    lastError: null,
    lastWarning: null,
    idCounter: 0,
  };
}

function nextId(draft: AppState, prefix: string): string {
  draft.idCounter += 1;
  return `${prefix}-${draft.idCounter}`;
}

// 取り込みやプリセットで使われている工程IDと衝突しないIDを発番する
function nextOperationId(draft: AppState): string {
  let id = nextId(draft, 'OPN');
  while (draft.operations.some((o) => o.operationId === id)) id = nextId(draft, 'OPN');
  return id;
}

export type AppAction =
  // operationNamesは同梱サンプル用：工程の名称（MasterSnapshotに無い）を `${itemId}:${opCode}` で与える（PLM-EXT-20）
  | { type: 'sync/import'; json: unknown; importedAtDay: number; operationNames?: Record<string, string> }
  | { type: 'item/create'; input: Parameters<typeof item.createItem>[1] }
  | { type: 'item/advanceLifecycle'; itemId: string; to: ItemLifecycleStatus }
  | { type: 'item/update'; itemId: string; patch: Parameters<typeof item.updateItem>[2] }
  | { type: 'item/delete'; itemId: string }
  | { type: 'ebom/addLine'; input: ebom.NewEbomLineInput }
  | {
      type: 'ebom/reviseLine';
      bomLineId: string;
      patch: Parameters<typeof ebom.reviseEbomLine>[2];
      effectiveFromDay: number;
      changeId?: string;
    }
  // effectiveFromDayは「変更が効く日」（その日から旧行が無効になる。PLM-EXT-21）
  | { type: 'ebom/endLine'; bomLineId: string; effectiveFromDay: number; changeId?: string }
  | { type: 'ebom/replaceChild'; bomLineId: string; newChildItemId: string; effectiveFromDay: number; changeId?: string }
  | { type: 'variant/resolveConfiguration'; baseItemId: string; selections: Record<string, string>; resolvedItemId: string; resolvedItemName: string }
  | {
      type: 'mbom/convert';
      effectiveFromDay: number;
      // 150%BOM（未解決のオプショングループ）を含む品目を変換する場合は必須（UC-VARIANT-3）。
      // オプショングループを持たない品目（例：自転車）ではundefinedのままでよい。
      configuration?: { baseItemId: string; selections: Record<string, string>; resolvedItemId: string };
    }
  | { type: 'mbom/setAlternateOverride'; alternateGroupId: string; childItemId: string }
  // 投入工程の割り当て（opCodeを省くと未割当に戻す。PLM-EXT-18）
  | { type: 'mbom/assignOperation'; bomLineId: string; opCode?: string }
  | { type: 'operation/add'; input: Omit<operation.NewOperationInput, 'operationId'> }
  | {
      type: 'operation/revise';
      operationId: string;
      patch: operation.OperationPatch;
      effectiveFromDay: number;
      changeId?: string;
    }
  | { type: 'operation/reorder'; itemId: string; opCodesInOrder: string[]; effectiveFromDay: number; changeId?: string }
  | { type: 'operation/end'; operationId: string; effectiveToDay: number }
  | { type: 'resource/add'; input: Omit<resource.NewResourceInput, 'resourceId'> }
  | { type: 'resource/remove'; resourceId: string }
  | { type: 'change/create'; input: changeManagement.NewChangeRequestInput }
  | { type: 'change/submitForReview'; changeId: string }
  | { type: 'change/recordApproval'; changeId: string; decision: ApproverDecision }
  | { type: 'change/issueEco'; changeId: string; effectiveFromDay: number }
  | { type: 'change/notifyEcn'; changeId: string }
  | { type: 'change/close'; changeId: string }
  | { type: 'change/withdraw'; changeId: string }
  | { type: 'document/register'; input: document.NewDocumentInput }
  | { type: 'document/revise'; docId: string }
  | { type: 'sync/preflight'; currentJson: unknown }
  | { type: 'sync/resolveConflict'; kind: 'item' | 'bomLine' | 'routing'; key: string; resolution: 'ours' | 'theirs' }
  | { type: 'sync/confirmExport'; sourceChangeId: string }
  | { type: 'ui/dismissError' }
  | { type: 'ui/dismissWarning' }
  | { type: 'ui/advanceDay'; byDays: number };

// 現在有効なM-BOM行に代替部品の解決を適用したもの（エクスポート・原価算出等で使う実効BOM）。
export function effectiveMbomLines(state: AppState): PlmBomLine[] {
  return mbom.resolveAlternates(mbom.currentMbomLines(state.bomLines), state.alternateOverrides);
}

export function reducer(state: AppState, action: AppAction): AppState {
  const draft = structuredClone(state);
  draft.lastError = null;
  draft.lastWarning = null;

  try {
    applyAction(draft, action);
  } catch (err) {
    draft.lastError = err instanceof Error ? err.message : String(err);
    return draft;
  }
  return draft;
}

function applyAction(draft: AppState, action: AppAction): void {
  switch (action.type) {
    case 'sync/import': {
      const result = masterSnapshot.importMasterSnapshotFromJson(action.json, action.importedAtDay);
      draft.items = result.items;
      draft.bomLines = result.bomLines;
      draft.operations = result.operations.map((o) => ({
        ...o,
        name: action.operationNames?.[`${o.itemId}:${o.opCode}`] ?? o.name,
      }));
      // 取り込みはマスタ全体の置き換え。資源が指していた工程は無くなるので、資源も消す（PLM-EXT-19）
      draft.operationResources = [];
      draft.passthrough = result.passthrough;
      draft.syncSession = result.session;
      // 取り込み前の現状確認の結果は、別のマスタについてのものなので捨てる（PLM-EXT-20）
      draft.exportPreflight = null;
      draft.pendingCurrentSnapshot = null;
      draft.currentDay = action.importedAtDay;
      break;
    }

    case 'item/create': {
      item.createItem(draft.items, action.input);
      break;
    }
    case 'item/advanceLifecycle': {
      item.advanceLifecycleStatus(draft.items, action.itemId, action.to);
      break;
    }
    case 'item/update': {
      item.updateItem(draft.items, action.itemId, action.patch);
      break;
    }
    case 'item/delete': {
      item.deleteItem(draft.items, action.itemId);
      break;
    }

    case 'ebom/addLine': {
      assertKnownChange(draft, action.input.changeId);
      ebom.addEbomLine(draft.bomLines, action.input);
      break;
    }
    case 'ebom/reviseLine': {
      // プリセットや取り込みで使われている行IDと衝突しないIDを発番する（PLM-EXT-16）
      let newBomLineId = nextId(draft, 'E');
      while (draft.bomLines.some((l) => l.bomLineId === newBomLineId)) newBomLineId = nextId(draft, 'E');
      assertKnownChange(draft, action.changeId);
      ebom.reviseEbomLine(draft.bomLines, action.bomLineId, action.patch, newBomLineId, action.effectiveFromDay, action.changeId);
      break;
    }
    case 'ebom/endLine': {
      assertKnownChange(draft, action.changeId);
      ebom.endEbomLine(draft.bomLines, action.bomLineId, action.effectiveFromDay, action.changeId);
      break;
    }
    case 'ebom/replaceChild': {
      assertKnownChange(draft, action.changeId);
      if (!draft.items.some((i) => i.itemId === action.newChildItemId)) {
        throw new Error(`品目 ${action.newChildItemId} が見つかりません`);
      }
      let newBomLineId = nextId(draft, 'E');
      while (draft.bomLines.some((l) => l.bomLineId === newBomLineId)) newBomLineId = nextId(draft, 'E');
      ebom.replaceEbomChild(
        draft.bomLines,
        action.bomLineId,
        action.newChildItemId,
        newBomLineId,
        action.effectiveFromDay,
        action.changeId,
      );
      break;
    }

    case 'variant/resolveConfiguration': {
      // 150%BOMのE-BOM行（テンプレート）自体は変更しない。ここでは（a）解決後に
      // 新しい品目コードが必要ならその品目を作成し、（b）選択結果をConfigurationとして
      // 記録するだけに留める。実際にBOM行を確定させるのはmbom/convert（7.2）の役目。
      const baseItem = draft.items.find((i) => i.itemId === action.baseItemId);
      if (!baseItem) throw new Error(`品目 ${action.baseItemId} が見つかりません`);

      const configuration: Configuration = {
        configId: nextId(draft, 'CFG'),
        baseItemId: action.baseItemId,
        selections: action.selections,
        resolvedItemId: action.resolvedItemId,
      };

      if (action.resolvedItemId !== action.baseItemId && !draft.items.some((i) => i.itemId === action.resolvedItemId)) {
        item.createItem(draft.items, {
          itemId: action.resolvedItemId,
          name: action.resolvedItemName,
          makeBuy: baseItem.makeBuy,
          leadTimeDays: baseItem.leadTimeDays,
          salesPrice: baseItem.salesPrice,
        });
      }

      draft.configurations.push(configuration);
      break;
    }

    case 'mbom/convert': {
      const ebomLines = ebom.currentEbomLines(draft.bomLines);
      const sourceLines = action.configuration
        ? ebom.resolveConfiguration(ebomLines, { configId: 'preview', ...action.configuration })
        : ebomLines;
      // 投入工程の既定値は、親品目の最初の工程（PLM-EXT-18）
      const converted = mbom.convertEbomToMbom(
        sourceLines,
        operation.firstOperationCodes(draft.operations),
        action.effectiveFromDay,
      );
      // バリアント解決を経た変換の場合、テンプレートを共有する複数の確定品目
      // （例：FG-100とFG-101）を同一セッションで変換してもbomLineIdが衝突しないようにする。
      const suffix = action.configuration ? `-${action.configuration.resolvedItemId}` : '';
      // 再変換で行が重複しないよう、同じ変換範囲の既存M-BOM行と突き合わせて取り込む（PLM-EXT-16）。
      // 変換範囲（構成なし／確定品目ごと）は各行のmbomScopeに記録する。
      const scope = action.configuration?.resolvedItemId;
      mbom.mergeConvertedMbom(
        draft.bomLines,
        converted.map((line) => ({ ...line, bomLineId: `${line.bomLineId}${suffix}`, mbomScope: scope })),
        scope,
        action.effectiveFromDay,
      );
      // 再変換で代替部品の行が無くなった場合、その行を選んでいた切り替えは外す（既定の選択に戻る）。
      // 残したままだと、実効M-BOMの解決が「承認済ではない」と例外になる（PLM-EXT-21）
      const approved = mbom.currentMbomLines(draft.bomLines).filter((l) => l.alternateGroupId && l.approvalStatus === '承認済');
      for (const [groupId, childItemId] of Object.entries(draft.alternateOverrides)) {
        if (!approved.some((l) => l.alternateGroupId === groupId && l.childItemId === childItemId)) {
          delete draft.alternateOverrides[groupId];
        }
      }
      break;
    }
    case 'mbom/setAlternateOverride': {
      // 承認済かどうかの検証はresolveAlternatesが行う（未承認選択はここで例外化される、UC-ALT-3）
      mbom.resolveAlternates(mbom.currentMbomLines(draft.bomLines), {
        ...draft.alternateOverrides,
        [action.alternateGroupId]: action.childItemId,
      });
      draft.alternateOverrides[action.alternateGroupId] = action.childItemId;
      break;
    }

    case 'mbom/assignOperation': {
      mbom.assignInputOperation(draft.bomLines, draft.operations, action.bomLineId, action.opCode);
      break;
    }

    case 'operation/add': {
      operation.addOperation(draft.operations, draft.items, draft.passthrough.workCenters, {
        ...action.input,
        operationId: nextOperationId(draft),
      });
      touchRouting(draft, action.input.itemId);
      break;
    }
    case 'operation/revise': {
      operation.reviseOperation(
        draft.operations,
        draft.passthrough.workCenters,
        action.operationId,
        action.patch,
        nextOperationId(draft),
        action.effectiveFromDay,
        action.changeId,
      );
      touchRouting(draft, draft.operations.find((o) => o.operationId === action.operationId)?.itemId);
      break;
    }
    case 'operation/reorder': {
      const countBefore = draft.operations.length;
      operation.reorderOperations(
        draft.operations,
        action.itemId,
        action.opCodesInOrder,
        () => nextOperationId(draft),
        action.effectiveFromDay,
        action.changeId,
      );
      // 今と同じ並びを渡した場合は何も変わらないので、「PLMが触った」には数えない
      if (draft.operations.length !== countBefore) touchRouting(draft, action.itemId);
      break;
    }
    case 'operation/end': {
      // 投入工程として参照されている工程は終了できない（先に割り当てを変える。PLM-EXT-18）
      const target = draft.operations.find((o) => o.operationId === action.operationId);
      if (target && target.effectiveToDay === undefined) {
        const users = mbom.linesUsingOperation(draft.bomLines, target.itemId, target.opCode);
        if (users.length > 0) {
          throw new Error(
            `工程 ${target.opCode}（${target.itemId}）は、M-BOM行 ${users.map((l) => `${l.parentItemId} → ${l.childItemId}`).join('、')} の投入工程のため終了できません。先に投入工程を変えてください`,
          );
        }
      }
      // 資源が登録されている工程も終了できない（先に資源を削除する。PLM-EXT-19）
      if (target && target.effectiveToDay === undefined) {
        const used = resource.resourcesOfOperation(draft.operationResources, target.itemId, target.opCode);
        if (used.length > 0) {
          throw new Error(
            `工程 ${target.opCode}（${target.itemId}）には資源が${used.length}件登録されているため終了できません。先に資源を削除してください`,
          );
        }
      }
      operation.endOperation(draft.operations, action.operationId, action.effectiveToDay);
      touchRouting(draft, target?.itemId);
      break;
    }

    case 'resource/add': {
      let resourceId = nextId(draft, 'RES');
      while (draft.operationResources.some((r) => r.resourceId === resourceId)) resourceId = nextId(draft, 'RES');
      resource.addResource(draft.operationResources, draft.operations, { ...action.input, resourceId });
      break;
    }
    case 'resource/remove': {
      resource.removeResource(draft.operationResources, action.resourceId);
      break;
    }

    case 'change/create': {
      changeManagement.createChangeRequest(draft.changes, action.input, effectiveMbomLines(draft));
      break;
    }
    case 'change/submitForReview': {
      changeManagement.submitForReview(draft.changes, action.changeId);
      break;
    }
    case 'change/recordApproval': {
      changeManagement.recordApproval(draft.changes, action.changeId, action.decision);
      break;
    }
    case 'change/issueEco': {
      changeManagement.issueEco(draft.changes, action.changeId, action.effectiveFromDay);
      break;
    }
    case 'change/notifyEcn': {
      changeManagement.notifyEcn(draft.changes, action.changeId);
      break;
    }
    case 'change/close': {
      const change = draft.changes.find((c) => c.changeId === action.changeId);
      const { warning } = changeManagement.closeChange(draft.changes, action.changeId);
      if (change) masterSnapshot.recordTouchedByChange(ensureSession(draft), change, draft.bomLines);
      draft.lastWarning = warning;
      break;
    }
    case 'change/withdraw': {
      changeManagement.withdrawChange(draft.changes, action.changeId, draft.syncEvents);
      break;
    }

    case 'document/register': {
      document.registerDocument(draft.documents, draft.items, action.input);
      break;
    }
    case 'document/revise': {
      document.reviseDocument(draft.documents, action.docId);
      break;
    }

    case 'sync/preflight': {
      const current = masterSnapshot.parseMasterSnapshot(action.currentJson);
      masterSnapshot.assertSnapshotUsable(current);
      const session = draft.syncSession;
      if (!session) throw new Error('マスタが未インポートのためエクスポート前確認はできません');
      const result = masterSnapshot.preflightExport(session, current, draft.items, effectiveMbomLines(draft), draft.operations);
      draft.exportPreflight = result;
      draft.pendingCurrentSnapshot = current;
      break;
    }
    case 'sync/resolveConflict': {
      const session = draft.syncSession;
      const current = draft.pendingCurrentSnapshot;
      if (!session || !current) throw new Error('先にエクスポート前確認（sync/preflight）を実行してください');

      if (action.kind === 'item') {
        const theirsItem = current.items.find((i) => i.itemId === action.key);
        const baseIdx = session.baseline.items.findIndex((i) => i.itemId === action.key);
        if (theirsItem) {
          if (baseIdx >= 0) session.baseline.items[baseIdx] = theirsItem;
          else session.baseline.items.push(theirsItem);
        } else if (baseIdx >= 0) {
          session.baseline.items.splice(baseIdx, 1);
        }
        if (action.resolution === 'theirs' && theirsItem) {
          const ourIdx = draft.items.findIndex((i) => i.itemId === action.key);
          const ourPlmExtras = draft.items[ourIdx];
          const merged: PlmItem = {
            ...theirsItem,
            lifecycleStatus: ourPlmExtras?.lifecycleStatus ?? '量産',
            spec: ourPlmExtras?.spec,
            drawingRef: ourPlmExtras?.drawingRef,
          };
          if (ourIdx >= 0) draft.items[ourIdx] = merged;
          else draft.items.push(merged);
        }
      } else if (action.kind === 'routing') {
        // 工順の競合（PLM-EXT-20）。品目・BOM行と同じく、ベースラインを相手側の現在値に進めて「相手は変えていない」
        // 状態にする。PLM側を採用するなら工程はそのまま（次の確認でPLM側の工順が書き出される）。
        // 相手側を採用するなら、PLM側の工程も相手側の工順に合わせる
        session.baseline.routingSteps = [
          ...session.baseline.routingSteps.filter((s) => s.itemId !== action.key),
          ...masterSnapshot.routingOfItem(current.routingSteps, action.key),
        ];
        if (action.resolution === 'theirs') {
          adoptTheirRouting(draft, action.key, current);
        }
      } else {
        const theirsLine = current.bom.find((l) => `${l.parentItemId}::${l.childItemId}` === action.key);
        const baseIdx = session.baseline.bom.findIndex((l) => `${l.parentItemId}::${l.childItemId}` === action.key);
        if (theirsLine) {
          if (baseIdx >= 0) session.baseline.bom[baseIdx] = theirsLine;
          else session.baseline.bom.push(theirsLine);
        } else if (baseIdx >= 0) {
          session.baseline.bom.splice(baseIdx, 1);
        }
        if (action.resolution === 'theirs' && theirsLine) {
          const ourIdx = draft.bomLines.findIndex(
            // 旧版化した行（PLM-EXT-16）は履歴なので書き換えない。現行行だけを対象にする
            (l) => l.bomType === 'M' && l.effectiveToDay === undefined && `${l.parentItemId}::${l.childItemId}` === action.key,
          );
          if (ourIdx >= 0) {
            draft.bomLines[ourIdx] = { ...draft.bomLines[ourIdx], qtyPer: theirsLine.qtyPer };
          }
        }
      }

      const result = masterSnapshot.preflightExport(session, current, draft.items, effectiveMbomLines(draft), draft.operations);
      draft.exportPreflight = result;
      break;
    }
    case 'sync/confirmExport': {
      const result = draft.exportPreflight;
      const session = draft.syncSession;
      if (!result || !session) throw new Error('先にエクスポート前確認（sync/preflight）を実行してください');
      if (result.status === 'conflict' || !result.mergedSnapshot) {
        throw new Error('競合が残っているためエクスポートできません。すべて解決してください（UC-SYNC-8）');
      }
      if (result.exportProblems && result.exportProblems.length > 0) {
        throw new Error(`エクスポートできません:\n- ${result.exportProblems.join('\n- ')}`);
      }
      // PLMが触っておらず相手側が変えた品目の工順は、相手側を自動採用している。PLM側の工程もそれに合わせる。
      // 作業区・得意先・仕入先は常に相手側の最新を採用するので、PLM側の控えも最新にする（PLM-EXT-20）
      const current = draft.pendingCurrentSnapshot;
      if (current) {
        for (const itemId of masterSnapshot.routingItemsChangedByThem(session.baseline, current)) {
          if (!session.touchedRoutingItemIds.has(itemId)) adoptTheirRouting(draft, itemId, current);
        }
        draft.passthrough = { workCenters: current.workCenters, customers: current.customers, suppliers: current.suppliers };
      }
      draft.syncEvents.push({
        eventId: nextId(draft, 'SYNC'),
        sourceChangeId: action.sourceChangeId,
        status: '送信済',
        exportedAtDay: draft.currentDay,
      });
      draft.syncSession = {
        importedAtDay: session.importedAtDay,
        baseline: result.mergedSnapshot,
        touchedItemIds: new Set(),
        touchedBomKeys: new Set(),
        touchedRoutingItemIds: new Set(),
      };
      draft.exportPreflight = null;
      draft.pendingCurrentSnapshot = null;
      break;
    }

    case 'ui/dismissError':
      break;
    case 'ui/dismissWarning':
      break;
    case 'ui/advanceDay':
      draft.currentDay += action.byDays;
      break;
  }
}

// 由来の変更は任意。指定するなら、登録済みの変更（状態は問わない）でなければならない（PLM-EXT-21）
function assertKnownChange(draft: AppState, changeId: string | undefined): void {
  if (changeId !== undefined && !draft.changes.some((c) => c.changeId === changeId)) {
    throw new Error(`変更 ${changeId} が見つかりません`);
  }
}

function ensureSession(draft: AppState): SyncSession {
  if (!draft.syncSession) {
    draft.syncSession = {
      importedAtDay: draft.currentDay,
      baseline: { version: 1, items: [], bom: [], routingSteps: [], workCenters: [], customers: [], suppliers: [] },
      touchedItemIds: new Set(),
      touchedBomKeys: new Set(),
      touchedRoutingItemIds: new Set(),
    };
  }
  return draft.syncSession;
}

// PLM側で工程を編集した品目を、操作の時点で記録する（3-wayマージの「PLMが触った」の判定に使う）
// 現状確認の結果は、確認した時点の工程から作っている。その後に工程を編集したら結果は古くなるので捨て、
// もう一度現状確認をしてもらう（古い結果のまま確定すると、編集した工程が書き出しから漏れる）
function touchRouting(draft: AppState, itemId: string | undefined): void {
  if (itemId === undefined) return;
  ensureSession(draft).touchedRoutingItemIds.add(itemId);
  draft.exportPreflight = null;
  draft.pendingCurrentSnapshot = null;
}

// 相手側の工順をPLM側の工程へ取り込む。相手側に無くなった工程は終了し、その工程の資源は消す
// （資源は版管理しないため。終了した工程を指していたM-BOM行は、投入工程が無効の警告に出る）。
// 相手側の工順が新しい作業区を指していることがあるので、控えに無い作業区は足す
// （控え全体を相手側の最新に置き換えるのは、エクスポート確定のとき）
function adoptTheirRouting(draft: AppState, itemId: string, current: MasterSnapshot): void {
  const ended = operation.adoptRoutingSteps(
    draft.operations,
    itemId,
    current.routingSteps,
    () => nextOperationId(draft),
    draft.currentDay,
  );
  draft.operationResources = draft.operationResources.filter(
    (r) => !ended.some((o) => o.itemId === r.itemId && o.opCode === r.opCode),
  );
  const known = new Set(draft.passthrough.workCenters.map((w) => w.workCenter));
  draft.passthrough.workCenters.push(...current.workCenters.filter((w) => !known.has(w.workCenter)));
}

export { generateNewItemCode } from './item';
export type { ItemCodePrefix, ChangeReason };

import { useReducer, useState } from 'react';
import { loadSavedState, readSettings, type BootResult, type KeyValueStorage } from '../domain/persistence';
import { createWoodenChairDemoState } from '../domain/presets';
import { reducer } from '../domain/reducer';
import { Banner } from './components/Banner';
import { PersistenceMenu, PersistenceNotices } from './components/PersistenceControls';
import { browserStorage, usePersistence } from './usePersistence';
import { Onboarding } from './Onboarding';
import { ChangeManagementTab } from './tabs/ChangeManagementTab';
import { DocumentTab } from './tabs/DocumentTab';
import { EbomTab } from './tabs/EbomTab';
import { ImpactTab } from './tabs/ImpactTab';
import { ItemsTab } from './tabs/ItemsTab';
import { MbomTab } from './tabs/MbomTab';
import { OperationTab } from './tabs/OperationTab';
import { PlanningBomTab } from './tabs/PlanningBomTab';
import { PurchaseBomTab } from './tabs/PurchaseBomTab';
import { ResourceTab } from './tabs/ResourceTab';
import { SyncTab } from './tabs/SyncTab';

type TabKey = 'item' | 'ebom' | 'mbom' | 'operation' | 'resource' | 'change' | 'document' | 'sync' | 'impact' | 'purchase' | 'planning';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'item', label: '品目' },
  { key: 'ebom', label: 'E-BOM' },
  { key: 'mbom', label: 'M-BOM' },
  { key: 'operation', label: '工程（BOP）' },
  { key: 'resource', label: '資源（BOR）' },
  { key: 'change', label: '変更管理' },
  { key: 'document', label: '文書' },
  { key: 'sync', label: '連携' },
  { key: 'impact', label: '影響分析' },
  { key: 'purchase', label: '発注BOM' },
  { key: 'planning', label: '計画BOM' },
];

// 起動時に一度だけ保存データを読む。読めなければサンプル（木製イス）で起動する（PLM-EXT-24・25）。
// 読み込みは壊れたデータの退避という副作用を伴うので、StrictMode の二重呼び出しでも1回だけにする
let bootResult: { storage: KeyValueStorage | null; result: BootResult; enabled: boolean } | null = null;
function bootOnce() {
  if (!bootResult) {
    const storage = browserStorage();
    bootResult = { storage, result: loadSavedState(storage), enabled: readSettings(storage).enabled };
  }
  return bootResult;
}

export function App() {
  const [boot] = useState(bootOnce);
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    boot.result.kind === 'restored' ? boot.result.state : createWoodenChairDemoState(),
  );
  const persistence = usePersistence(boot.storage, state, boot.enabled);
  const [activeTab, setActiveTab] = useState<TabKey>('item');
  // オンボーディングは保存データから再開したときは出さない（所有者決定 Q3）。
  // 保存データを読めなかったときも、理由のお知らせがツアーの下に隠れないよう出さない
  const [showOnboarding, setShowOnboarding] = useState(boot.result.kind === 'fresh' || boot.result.kind === 'unavailable');
  const [showEcrGuide, setShowEcrGuide] = useState(true);
  const [prefillImpactedItemIds, setPrefillImpactedItemIds] = useState<string[] | null>(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>PLMシミュレーター</h1>
        <p className="app-header__subtitle">
          品目・E-BOM・M-BOM・変更管理を通じて学ぶ、PDM＋ECM相当のPLM教材（完全なPLMスコープではありません、1.1）
        </p>
        {/* 現在日。BOM行・工程の改訂は「新しい版の開始日が旧版より後」が条件なので、日を進める操作を置く。
            日を進めても業務処理は何も動かない（日付が1日進むだけ） */}
        <div className="app-header__clock">
          <span role="status">
            現在日：<strong>D{state.currentDay}</strong>
          </span>
          <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'ui/advanceDay', byDays: 1 })}>
            次の日へ進む
          </button>
          <span className="app-header__subtitle">日付だけが進みます。BOM行・工程の改訂は、前の版より後の日に行えます。</span>
        </div>
        <PersistenceMenu persistence={persistence} />
      </header>

      <PersistenceNotices boot={boot.result} storage={boot.storage} persistence={persistence} />

      {state.lastError && <Banner kind="error" message={state.lastError} />}
      {state.lastWarning && <Banner kind="warning" message={state.lastWarning} />}

      <nav className="tab-nav" aria-label="ドメインタブ">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab-nav__button${activeTab === tab.key ? ' tab-nav__button--active' : ''}`}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'item' && <ItemsTab state={state} dispatch={dispatch} />}
        {activeTab === 'ebom' && <EbomTab state={state} dispatch={dispatch} />}
        {activeTab === 'mbom' && <MbomTab state={state} dispatch={dispatch} />}
        {activeTab === 'operation' && <OperationTab state={state} dispatch={dispatch} />}
        {activeTab === 'resource' && <ResourceTab state={state} dispatch={dispatch} />}
        {activeTab === 'change' && (
          <ChangeManagementTab
            state={state}
            dispatch={dispatch}
            prefillImpactedItemIds={prefillImpactedItemIds}
            onPrefillConsumed={() => setPrefillImpactedItemIds(null)}
            showGuide={showEcrGuide}
            onDismissGuide={() => setShowEcrGuide(false)}
          />
        )}
        {activeTab === 'document' && <DocumentTab state={state} dispatch={dispatch} />}
        {activeTab === 'sync' && <SyncTab state={state} dispatch={dispatch} />}
        {activeTab === 'impact' && (
          <ImpactTab
            state={state}
            dispatch={dispatch}
            onRequestEcr={(ids) => {
              setPrefillImpactedItemIds(ids);
              setActiveTab('change');
            }}
          />
        )}
        {activeTab === 'purchase' && <PurchaseBomTab state={state} />}
        {activeTab === 'planning' && <PlanningBomTab state={state} />}
      </main>

      {showOnboarding && (
        <Onboarding
          items={state.items}
          bomLines={state.bomLines}
          onConvert={() =>
            dispatch({
              type: 'mbom/convert',
              effectiveFromDay: state.currentDay,
              configuration: { baseItemId: 'FG-100', selections: { 'OG-SEAT-FINISH': '無垢材' }, resolvedItemId: 'FG-100' },
            })
          }
          onFinish={() => {
            setShowOnboarding(false);
            setActiveTab('change');
          }}
          onSkip={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
}

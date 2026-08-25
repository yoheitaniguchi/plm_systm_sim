import { useReducer, useState } from 'react';
import { createWoodenChairDemoState } from '../domain/presets';
import { reducer } from '../domain/reducer';
import { Banner } from './components/Banner';
import { Onboarding } from './Onboarding';
import { ChangeManagementTab } from './tabs/ChangeManagementTab';
import { DocumentTab } from './tabs/DocumentTab';
import { EbomTab } from './tabs/EbomTab';
import { ImpactTab } from './tabs/ImpactTab';
import { ItemsTab } from './tabs/ItemsTab';
import { MbomTab } from './tabs/MbomTab';
import { PlanningBomTab } from './tabs/PlanningBomTab';
import { PurchaseBomTab } from './tabs/PurchaseBomTab';
import { SyncTab } from './tabs/SyncTab';

type TabKey = 'item' | 'ebom' | 'mbom' | 'change' | 'document' | 'sync' | 'impact' | 'purchase' | 'planning';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'item', label: '品目' },
  { key: 'ebom', label: 'E-BOM' },
  { key: 'mbom', label: 'M-BOM' },
  { key: 'change', label: '変更管理' },
  { key: 'document', label: '文書' },
  { key: 'sync', label: '連携' },
  { key: 'impact', label: '影響分析' },
  { key: 'purchase', label: '発注BOM' },
  { key: 'planning', label: '計画BOM' },
];

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createWoodenChairDemoState);
  const [activeTab, setActiveTab] = useState<TabKey>('item');
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showEcrGuide, setShowEcrGuide] = useState(true);
  const [prefillImpactedItemIds, setPrefillImpactedItemIds] = useState<string[] | null>(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>PLMシミュレーター</h1>
        <p className="app-header__subtitle">
          品目・E-BOM・M-BOM・変更管理を通じて学ぶ、PDM＋ECM相当のPLM教材（完全なPLMスコープではありません、1.1）
        </p>
      </header>

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
              routingMap: Object.fromEntries(state.passthrough.routingSteps.map((s) => [s.itemId, s.workCenter])),
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

import { useState } from 'react';
import { currentEbomLines } from '../domain/ebom';
import { currentMbomLines } from '../domain/mbom';
import type { PlmBomLine, PlmItem } from '../domain/types';
import { BomTree } from './components/BomTree';
import { MbomFlattenAnimation } from './components/MbomFlattenAnimation';

interface OnboardingProps {
  items: PlmItem[];
  bomLines: PlmBomLine[];
  onConvert: () => void;
  onFinish: () => void;
  onSkip: () => void;
}

// 10.2 トリガー1の台本（Rev.H）：木製イスのE-BOM構造を巡る5ステップのオンボーディング。
export function Onboarding({ items, bomLines, onConvert, onFinish, onSkip }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const ebomLines = currentEbomLines(bomLines).filter((l) => l.optionGroupId === undefined || l.optionCode === '無垢材');
  const mbomLines = currentMbomLines(bomLines);

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="木製イスのE-BOM構造ツアー">
      <div className="onboarding-card">
        <div className="onboarding-card__header">
          <span>ステップ {step} / 5</span>
          <button type="button" className="link-button" onClick={onSkip}>
            スキップ
          </button>
        </div>

        {step === 1 && (
          <>
            <h2>木製イスのE-BOM</h2>
            <p>これはPLM側だけが持つ設計視点の部品表です。生産管理システムのBOMとは異なる構造を持てます。</p>
            <BomTree rootItemId="FG-100" lines={ebomLines} items={items} />
          </>
        )}

        {step === 2 && (
          <>
            <h2>「脚部ユニット」に注目</h2>
            <p>
              これは<strong>E-BOMだけに存在する機能グループ</strong>で、M-BOMには存在しません。設計上の便宜的なまとまりです。
            </p>
            <BomTree rootItemId="FG-100" lines={ebomLines} items={items} highlightItemId="EU-450" />
          </>
        )}

        {step === 3 && (
          <>
            <h2>M-BOMへ変換してみましょう</h2>
            <p>変換すると「脚部ユニット」は消滅し、脚とネジが木製イス直下へフラット化されます。</p>
            <MbomFlattenAnimation rootItemId="FG-100" ebomLines={ebomLines} items={items} flattened={mbomLines.length > 0} />
            {mbomLines.length > 0 ? (
              <p className="muted" aria-live="polite">
                脚部ユニットが消滅し、脚とネジが木製イス直下へ移動しました。「次へ」で確認しましょう。
              </p>
            ) : (
              <button type="button" className="primary-button" onClick={onConvert}>
                M-BOMに変換
              </button>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2>これが実際に生産管理システムで使われる形です</h2>
            <p>変換後のM-BOMは、production_system_sim側の実際のBOM構造と一致します。</p>
            {mbomLines.length > 0 ? (
              <BomTree rootItemId="FG-100" lines={mbomLines} items={items} />
            ) : (
              <p className="muted">（まだ変換していません。前の画面の「M-BOMに変換」を押してください）</p>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h2>では実際に変更をしてみましょう</h2>
            <p>次は「変更管理」タブで、ECR（変更要求）の起票から承認・ECO発行・ECN通知・クローズまでの流れを体験します。</p>
          </>
        )}

        <div className="onboarding-card__footer">
          {step > 1 && (
            <button type="button" className="secondary-button" onClick={() => setStep((s) => s - 1)}>
              戻る
            </button>
          )}
          {step < 5 ? (
            <button type="button" className="primary-button" onClick={() => setStep((s) => s + 1)}>
              次へ
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onFinish}>
              始める
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

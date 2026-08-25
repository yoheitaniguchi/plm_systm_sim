# CLAUDE.md

このファイルはClaude Codeがこのプロジェクトで作業する際に毎回読み込む。簡潔さを優先しているので、
設計判断の根拠や検討の経緯を確認したいときは `docs/design.md`（要件書との差分・追加決定）と
`PLM_simulator_requirements.md`（業務要件の一次資料、Rev.H）、`docs/implementation-plan.md`
（実装フェーズの記録）を参照すること。

## プロジェクト概要

PLM（正確にはPDM＋ECM相当）の中核概念——品目ライフサイクル、E-BOM／M-BOMの構造差、ECR→ECO→ECNの
変更管理、PLM⇄生産管理システムのマスタ連携——を、実際に操作しながら学べる教材シミュレーター。
木製イス（`PLM_simulator_requirements.md` §4.1、2階層BOM＋E-BOM限定の「脚部ユニット」機能グループ）を
基礎題材に、自転車（§4.2、4階層BOM）を応用題材として、品目・E-BOM・M-BOM・変更管理・文書・
マスタ連携・影響分析の7ドメインを横断して体験できる。

対象読者は開発チームメンバー。商用製品ではなく教材。

**姉妹リポジトリ`production_system_sim`との関係**：本リポジトリは`production_system_sim`
（生産管理トレーニングシミュレーター）と**対称的な設計**にすることで、「PLMで起きた変更が生産管理側に
どう波及するか」を横断的に体験できるようにする（要件書1.1）。アーキテクチャ（React + TypeScript + Vite、
バックエンドなし、`useReducer`による状態管理、ドメインロジックを`src/domain/`配下にドメインごとの
ファイルへ分割）を踏襲する一方、`production_system_sim`が意図的に実装していないBOMのバージョニング・
有効日・E-BOM/M-BOMの系統分離・品目ライフサイクルを、本リポジトリが補完する関係にある（要件書9.5）。
連携は`production_system_sim`の`masterIO.ts`が入出力する`MasterSnapshot`互換JSONのファイル手動受け渡し
（疎結合・B案、要件書9章）で行い、`production_system_sim`側の改修は不要。

**スコープの明示**（要件書1.1・9.5）：本シミュレーターが扱う範囲（品目・BOM・図面のエンジニアリング
チェーン管理と変更管理）は、厳密には**PDM＋ECM相当**であり、原価企画・品質記録・サプライヤ管理まで
含めた完全なPLMのスコープではない。

## 技術スタック・アーキテクチャ

- React + TypeScript + Vite。**バックエンドサーバーは持たない**（`docs/design.md` §1参照）
- 状態は `useReducer` で一元管理。永続化なし（DBなし）、単一セッション、ページリロードで状態は消える
- ドメインロジックは `src/domain/` 配下にドメインごとのファイルへ分割し、純粋関数として実装してUIから
  独立させる（要件書2章のディレクトリ構成をそのまま踏襲）
- **操作粒度は要件書8章のユースケース単位**。品目のライフサイクル遷移・E-BOM/M-BOM編集・
  ECR起票〜クローズ・マスタ連携の各操作は、いずれも個別のユーザー操作である

## ディレクトリ構成

```
plm_systm_sim/
├── CLAUDE.md                    # このファイル
├── README.md                    # 人間向けの概要
├── PLM_simulator_requirements.md # 要件書（Rev.H、業務要件の一次資料。原文のまま格納、直接編集しない）
├── docs/
│   ├── design.md                 # 要件書との差分・未規定点への追加決定・実装方針（★まず読む）
│   └── implementation-plan.md    # 実装フェーズの記録
├── package.json / tsconfig*.json / vite.config.ts / vitest.config.ts / playwright.config.ts
├── index.html
├── .github/workflows/            # test.yml（PR gate）・deploy.yml（GitHub Pages）
├── .claude/agents/                # レビュー専用サブエージェント
└── src/
    ├── main.tsx                  # エントリポイント
    ├── index.css                 # グローバルスタイル
    ├── test/setup.ts              # vitest + Testing Library セットアップ
    ├── domain/                   # ドメインロジック本体（design.md §4〜§6）★最重要ディレクトリ
    │   ├── types.ts                 # 共有型定義（production_system_simと互換な型＋PLM拡張、要件書5章）
    │   ├── item.ts                   # 品目ライフサイクル（要件書3章#1、6.1）
    │   ├── ebom.ts                    # E-BOM構造・版数・循環参照防御・バリアント（オプショングループ、4.4）
    │   ├── mbom.ts                    # M-BOM構造・E→M変換・代替部品解決（4.5、7.2、7.6）
    │   ├── changeManagement.ts        # ECR/ECO/ECN状態遷移・承認集計・取消可否（6.2、7.5）
    │   ├── document.ts                 # 文書・版数（3章#5）
    │   ├── masterSnapshot.ts           # MasterSnapshot入出力・SSOT競合検知（3-wayマージ、7.3、7.4、9.6）
    │   ├── impactAnalysis.ts           # BOM逆展開・影響分析・原価影響の簡易算出（7.1、7.7）
    │   ├── reducer.ts                  # useReducer用reducer。actionを各モジュールへディスパッチ
    │   ├── presets.ts                  # 教材用サンプルデータ（木製イス／自転車、4章）
    │   └── __tests__/*.test.ts         # 各モジュールに対応する単体テスト（61件）
    └── ui/                        # 画面（design.md §5）
        ├── App.tsx                    # タブナビゲーション＋オンボーディングの保持
        ├── Onboarding.tsx              # 初回起動時の5ステップガイド（要件書10.2）
        ├── format.ts                   # 表示用フォーマッタ
        ├── components/
        │   ├── BomTree.tsx                # E-BOM/M-BOM共用のツリー表示（深さ上限ガード付き）
        │   ├── MbomFlattenAnimation.tsx    # オンボーディングステップ3限定：脚部ユニット消滅→
        │   │                              # フラット化のCSSトランジション（要件書10.3）
        │   └── Banner.tsx                 # エラー・警告・情報バナー
        └── tabs/                       # 7ドメインの画面
            ├── ItemsTab.tsx / EbomTab.tsx / MbomTab.tsx / ChangeManagementTab.tsx
            └── DocumentTab.tsx / SyncTab.tsx / ImpactTab.tsx

e2e/                              # Playwright + axe-core（オンボーディング・7タブ横断・ECRフロー・a11y）
```

## コマンド

```bash
npm install
npm run dev          # 開発サーバー起動（ルート配信）
npm run build        # 型チェック（tsc -b）＋ビルド（vite build、GitHub Pages用baseパス）
npm run typecheck    # 型チェックのみ実行（tsc -b --noEmit）
npm run lint         # eslint
npm test             # vitestによる自動テスト全件実行（61件、要件書8章の42ユースケース相当）
npx vitest run <path> # 特定テストのみ実行（例: npx vitest run src/domain/__tests__/mbom.test.ts）
npm run preview      # build成果物をGitHub Pages相当のbaseパスで動作確認
npm run e2e          # Playwright＋axe-coreによるE2E・アクセシビリティ自動検査（npm run devを自動起動）
                      # 初回は npx playwright install --with-deps chromium が必要
```

## デプロイ

- `main`へのpushを契機に`.github/workflows/deploy.yml`が自動ビルド・テストし、`gh-pages`ブランチへ
  pushする（`peaceiris/actions-gh-pages`使用）
- `vite.config.ts`の`base`はビルド用途ごとに変える：`npm run dev`はルート配信、`build`/`preview`は
  `/plm_systm_sim/`（GitHub Pagesのプロジェクトサイト配信パスに合わせる）
- リポジトリのSettings→Pages→Build and deploymentのSourceは「Deploy from a branch」／`gh-pages`／
  `/(root)`に設定する（`gh-pages`ブランチは初回デプロイ時にワークフローが自動作成する。この設定自体は
  リポジトリオーナーによる一度きりの手動操作が必要）
- 公開URL: `https://<owner>.github.io/plm_systm_sim/`
- PRの作成・更新時は`.github/workflows/test.yml`が型チェック・lint・ビルド・vitest・E2E＋a11yを実行する
- PRの作成・更新（`opened`/`reopened`/`synchronize`）・クローズ時は`.github/workflows/pr-preview.yml`
  （`rossjrw/pr-preview-action`使用）が`gh-pages`ブランチの`pr-preview/pr-<番号>/`配下へビルド成果物を
  配信し、PRへプレビューURLをコメントする（クローズ時は自動削除）。ビルド時は`vite.config.ts`が読む
  `BASE_PATH`環境変数でこの配信先パスを上書きする。フォークからのPRは`GITHUB_TOKEN`が読み取り専用に
  なるため対象外（`if: github.event.pull_request.head.repo.full_name == github.repository`）

## 現在の実装状況

**要件書（Rev.H）の全ドメイン（品目・E-BOM・M-BOM・変更管理・文書・マスタ連携・影響分析）を実装済み。**

- `src/domain/`：8モジュール（`item.ts`・`ebom.ts`・`mbom.ts`・`changeManagement.ts`・`document.ts`・
  `masterSnapshot.ts`・`impactAnalysis.ts`）＋`reducer.ts`（`structuredClone`した状態を各ドメイン
  モジュールへ渡し、モジュール側が直接書き換える設計）を実装済み。教材データは`presets.ts`に
  木製イす（`createWoodenChairDemoState()`、脚部ユニットグループ・座面バリアント・脚の代替部品
  グループを含む）・自転車（`bicycleMasterSnapshot`、4階層BOM）の2題材を用意
- `src/domain/__tests__/`：61件のテストで、要件書8章のユースケース（UC-ITEM/EBOM/MBOM/ECM/DOC/SYNC/
  IMPACT/ALT/VARIANT、計42件相当）を検証済み
- `src/ui/`：7ドメインのタブ画面＋木製イすの5ステップオンボーディングツアー（要件書10.2の台本どおり、
  脚部ユニットのハイライト→M-BOM変換のライブデモを含む）を実装済み。ステップ3の変換操作では
  `MbomFlattenAnimation`が脚部ユニット消滅→フラット化をCSSトランジションで可視化する
  （`prefers-reduced-motion: reduce`時は即時切替、要件書10.3）。`App.tsx`は`useReducer`で
  reducerを保持し、タブ切り替えとオンボーディング表示の制御のみを行う
- `e2e/app.spec.ts`：Playwright + axe-coreで、オンボーディングの完走・スキップ、7タブ横断のナビゲーション、
  ECR→ECO→ECN→クローズの一連の操作フロー、アクセシビリティスキャン（critical/serious違反ゼロ）を
  ブラウザで確認済み（7件、全件green）
- `.github/workflows/`：`test.yml`（PR gate）・`deploy.yml`（GitHub Pages自動デプロイ）・
  `pr-preview.yml`（PRプレビュー配信）を整備済み

## 次にやるべきこと（優先順）

要件書12.1が「解決済み」とする論点はすべて実装に反映済み。着手前にユーザーに優先順位を確認すること。
候補（費用対効果が高い順）：

| ドメイン | 件名 | 費用対効果 | 概要 |
|---|---|---|---|
| 発注（新規） | 発注BOM（購買ビュー）の追加（[Issue #8](https://github.com/yoheitaniguchi/plm_systm_sim/issues/8)） | 中〜高 | M-BOMをBUY品目まで展開し、仕入先・単価・リードタイムを集計する読み取り専用タブ「発注BOM」を新設する。発注プロセス自体（発注書起票・受入検査等）は要件書1.3・11章のスコープ外方針を維持し、既存M-BOMを購買の目で読むレポートに限定する |
| 計画（新規） | 計画BOM（時系列BOM展開）の追加（[Issue #9](https://github.com/yoheitaniguchi/plm_systm_sim/issues/9)） | 中〜高 | 確定済みM-BOMを対象に、リードタイムを考慮した所要展開（needByDay/startByDay）を算出する読み取り専用タブ「計画BOM」を新設する。単一品目・単一数量のWhat-if展開に限定し、`production_system_sim`側の計画オーダ（トランザクション）連携は対象外 |
| 基盤（CI） | CI継続確認 | 高 | `.github/workflows/`（test.yml・deploy.yml・pr-preview.yml）が全PRで正しく動作し続けているかの継続確認 |
| 影響分析 | 原価影響のUI導線強化 | 中（`ImpactTab.tsx`は現状、代替部品切替の前後比較のみ。ECOのbefore/after BOMを明示的に比較する導線が無い） | ECOごとにbeforeBom（起票時点のスナップショット）を保持し、クローズ前後の原価影響をECR起票画面から直接確認できるようにする |
| マスタ | localStorage永続化 | 低〜中（実装コスト自体は低いが、要件書2章「永続化なし・単一セッション」という設計方針そのものの転換になるため、着手前に方針変更の可否をユーザーに確認する必要がある） | ブラウザリロードで状態が消える現状を、localStorageへの自動保存で解消する案 |

## 実装時に確認すべき設計判断（design.mdの要点）

- **バリアント解決は都度実行**：150%BOM（オプショングループ）のテンプレート行は複製せず、
  `resolveConfiguration()`を呼ぶたびに解決済みの行集合を都度導出する。解決結果をBOM行として
  永続化すると、テンプレートと解決済み行が同じ中間品（例：座面ASSY）を共有する場合に子が
  重複するバグを生む（design.md 追加決定PLM-EXT-4参照）
- **isEbomOnlyフラグはグループの子への行に付与する**：「脚部ユニット」等のE-BOM限定グループを表す際、
  フラグは「親→グループ」の行ではなく「グループ→子」の行に立てる。`convertEbomToMbom()`の
  `isEbomOnlyGroup()`判定がこの前提に依存する（design.md 追加決定PLM-EXT-2参照）
- **循環参照防止の三重防御**：①登録時にDFSで拒否（`ebom.wouldCreateCycle()`）、②MasterSnapshot
  インポート時に全件検査（`masterSnapshot.detectBomCycles()`）、③実行時は訪問済みSet＋深さ上限
  （`MAX_BOM_DEPTH = 20`、`impactAnalysis.whereUsed()`）で例外化。BOMを再帰的に辿るコードを
  新しく書くときは、必ずこのいずれかの防御を持たせること
- **承認集計は「全員承認必須・1人でも却下で即却下」**（`changeManagement.aggregateApprovalStatus()`）。
  多数決や過半数ではない
- **取消可否はSyncEventの有無で決まる**：ECOがエクスポート済み（`SyncEvent.status === '送信済'`）なら
  取消できず、新しいECRとして差し戻す運用にする（`changeManagement.checkWithdrawable()`）

## コーディング上の注意

- ドメインロジックの関数群は、呼び出し側（`reducer.ts`）が渡した状態のクローンを直接書き換える設計にする
  （`reducer.ts`側で`structuredClone`してから渡す）。この層の外側（UI等）からは純粋関数として扱うこと
- **BOMを再帰的に辿るコードを新しく書くときは、必ず訪問済み集合または深さ上限を持たせること**。
  永続化が無いので、無限再帰でブラウザが固まると演習内容がすべて失われる
- `production_system_sim`互換の型（`ItemMaster`・`BomLine`等）とPLM独自拡張（`PlmItem`・`PlmBomLine`等）を
  混同しないこと。`production_system_sim`へ書き出す際は`masterSnapshot.stripPlmOnlyItemFields()`/
  `stripPlmOnlyBomFields()`で必ずPLM独自属性を取り除く
- `PLM_simulator_requirements.md` は原文のまま保持する一次資料であり、直接編集しない。要件書自体への
  疑問・矛盾点が見つかった場合は`docs/design.md`（追加決定）に解釈を追記する形で解消する

## ロジック検証ループ

- `PLM_simulator_requirements.md` 8章のユースケース（UC-ITEM/EBOM/MBOM/ECM/DOC/SYNC/IMPACT/ALT/VARIANT）
  を、各`domain/__tests__/*.test.ts`にそのままテストケースとして書き起こし、`npm test`（vitest）で
  自動検証する
- テストが落ちたら、ドメインロジックの不具合かテスト記述の誤りかを要件書と`docs/design.md`の仕様と
  照らして判断し、ロジック側の不具合なら修正して再度`npm test`を回すサイクルを、全件passするまで
  繰り返す運用とする
- レビュー専用のサブエージェントを用意している：
  - `logic-reviewer`（`.claude/agents/logic-reviewer.md`）：`domain/`配下の実装とテストが要件書・
    design.mdの仕様と矛盾していないかの確認
  - `ux-reviewer`（`.claude/agents/ux-reviewer.md`）：UI/UXの操作性・アクセシビリティ・一貫性のレビュー
  - `issue-spec-reviewer`（`.claude/agents/issue-spec-reviewer.md`）：Issue下書きの目的・効果の明確さ／
    要件の分解粒度／開発方針との整合性／費用対効果／テンプレート必須項目の充足を確認し、改善済み
    下書きを生成する

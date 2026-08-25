# 実装計画

`PLM_simulator_requirements.md`（Rev.H）・`docs/design.md`に基づく実装フェーズの記録。
production_system_simの`docs/implementation-plan.md`と同じ形式（フェーズごとに計画→実施結果を記録する）を
踏襲するが、本プロジェクトは要件書自体がすでに型定義・状態遷移・疑似コードまで詳細化された完成度の
高いRev.H版だったため、production_system_simのような複数フェーズにまたがる仕様探索（Phase 2-A/2-B等の
段階的な拡張）は発生せず、Phase 0〜5を通しで一気に実装した。

## 0. Phase 0：プロジェクト初期化

- Vite + React + TypeScript のスキャフォールド（`npm create vite`が非対話環境で失敗したため、
  `package.json`・`tsconfig*.json`・`vite.config.ts`・`index.html`・`src/main.tsx`を手動で作成）
- テスト基盤：vitest（`vitest.config.ts`、jsdom環境、`@testing-library/react`）＋Playwright
  （`playwright.config.ts`）＋`@axe-core/playwright`
- eslint（`typescript-eslint`のflat config、`eslint-plugin-react-hooks`は`eslint@9`系との
  peer dependency衝突を避けるため`^5.1.0`を指定）

### 実施結果

`npm install`・`npx tsc -b`・`npx eslint .`が通る空のReactアプリまでを構築した。

---

## 1. Phase 1：ドメイン層（型定義・8モジュール・reducer・教材データ）

要件書5章の型定義を`domain/types.ts`へ、7章の疑似コードを対応する各`domain/*.ts`へ、可能な限り
逐語的に移植した。疑似コードのまま動かない箇所（`docs/design.md` §2のPLM-EXT-1〜12）は実装しながら
発見し、都度修正した。

実装順序：
1. `types.ts`（全ドメインが依存する共有型）
2. `item.ts` → `ebom.ts` → `mbom.ts`（BOM系はE-BOM→M-BOMの順に依存するため）
3. `impactAnalysis.ts`（`ebom.ts`/`mbom.ts`のBOM行を横断的に扱う）
4. `document.ts`（他ドメインへの依存が薄い）
5. `changeManagement.ts`（`impactAnalysis.ts`の原価影響算出を利用）
6. `masterSnapshot.ts`（全ドメインの型を横断する、最も依存関係が多いモジュール）
7. `reducer.ts`（全ドメインモジュールを束ねる）＋`presets.ts`（木製イす・自転車の教材データ）

### 実施結果

8モジュール（`item.ts`・`ebom.ts`・`mbom.ts`・`changeManagement.ts`・`document.ts`・
`masterSnapshot.ts`・`impactAnalysis.ts`）＋`reducer.ts`・`presets.ts`を実装した。
`reducer.ts`は要件書2章の方針（`structuredClone`した状態を各ドメインモジュールへ渡し、
モジュール側が直接書き換える）どおりに実装し、`try/catch`でドメイン層の例外を`state.lastError`へ
集約する薄いエラーハンドリング層を追加した（要件書には無い、UI表示のための実装判断）。

`presets.ts`では、要件書4.1の木製イす（脚部ユニット・座面バリアント・脚の代替部品グループを含む
完全に整備されたE-BOM）を`createWoodenChairDemoState()`として直接構築する設計にした
（design.md PLM-EXT-10）。

---

## 2. Phase 2：自動テスト（vitest）

要件書8章のユースケース（UC-ITEM/EBOM/MBOM/ECM/DOC/SYNC/IMPACT/ALT/VARIANT、計42件）を
そのままテストケースとして`domain/__tests__/*.test.ts`へ書き起こした。

### 実施結果

61件のテストで、42ユースケースに加えて以下の追加観点を検証した。

- 循環参照防止の三重防御（登録時DFS拒否・インポート時全件検査・実行時深さ上限）を、
  それぞれ独立したテストケースで確認（`ebom.test.ts`・`masterSnapshot.test.ts`・`impactAnalysis.test.ts`）
- `preflightExport()`の3-wayマージを「自動マージ（未接触＋相手変更）」「競合（両者接触）」
  「変更なし（clean）」の3パターンで確認（`masterSnapshot.test.ts`）
- `reducer.ts`統合テストとして、ECR→ECO→ECN→クローズの一連のディスパッチ、バリアント解決から
  M-BOM変換までの一連のディスパッチ、SSOT競合の検出→解決→再確認までの一連のディスパッチを検証
  （`reducer.test.ts`）
- `presets.ts`が生成するデータが自己矛盾しない（循環参照が無く、変換可能）ことを回帰的に確認

全61件がpassする状態を`npm test`で維持している。

---

## 3. Phase 3：画面実装（UI）

`design.md` §3の対応表どおり、7ドメイン×1タブ＋オンボーディングの構成で実装した。

### 実施結果

- `App.tsx`：`useReducer`でreducerを保持し、タブ切り替え（`activeTab`のuseState）と
  オンボーディング表示制御のみを行う薄いシェル
- 7タブ（`ItemsTab`・`EbomTab`・`MbomTab`・`ChangeManagementTab`・`DocumentTab`・`SyncTab`・
  `ImpactTab`）：各ドメインのCRUD・状態遷移操作をフォーム＋テーブルで提供
- `components/BomTree.tsx`：E-BOM/M-BOM共用のツリー表示。`MAX_BOM_DEPTH`超過・訪問済みノードの
  再訪問をUI側でもガードし、循環データが万一残っていてもブラウザが固まらないようにした
- `Onboarding.tsx`：要件書10.2の5ステップ台本をそのまま実装（脚部ユニットのハイライト→
  「M-BOMに変換」ボタンでライブに`mbom/convert`をディスパッチ→変換後のM-BOMを表示）
- `ChangeManagementTab.tsx`に、ECR起票フォームで対象品目に図面が無い場合の警告
  （`document.checkDocumentCoverage()`、UC-DOC-3）を統合
- `ImpactTab.tsx`から`ChangeManagementTab.tsx`へ、`whereUsed()`の結果を対象品目として
  引き継ぐクロスタブ導線（UC-IMPACT-3）を実装

---

## 4. Phase 4：E2E・アクセシビリティ

### 実施結果

`e2e/app.spec.ts`（Playwright + axe-core）で以下を検証した。

- オンボーディングの完走（5ステップ・M-BOM変換ボタンの実行を含む）とスキップ、
  スキップ後は再訪でも自動表示されないこと
- 7タブすべてへのナビゲーションでランタイムエラーが発生しないこと
- ECR→審査提出→承認→ECO発行→ECN通知→クローズの一連の操作をUI上で実行し、各ステップで
  ステータスバッジが正しく遷移すること
- メイン画面（オンボーディング終了後）でaxe-coreのcritical/serious違反が0件であること

7件全件がPlaywright（chromium）でgreenであることを確認済み。

---

## 5. Phase 5：ドキュメント整備・レビューエージェント・CI/CD

production_system_simを参考に、開発プロセス面の整備を行った。

### 実施結果

- `CLAUDE.md`：production_system_simと同じ構成（プロジェクト概要・技術スタック・ディレクトリ構成・
  コマンド・デプロイ・現在の実装状況・次にやるべきこと・実装時に確認すべき設計判断・コーディング上の
  注意・ロジック検証ループ）で新規作成
- `docs/design.md`：要件書の疑似コードだけでは解決しない実装判断を`PLM-EXT-1`〜`PLM-EXT-12`として
  記録（production_system_simの`EXT-N`表に相当）
- `docs/implementation-plan.md`：本ファイル
- `.claude/agents/`：`logic-reviewer.md`・`ux-reviewer.md`・`issue-spec-reviewer.md`を
  production_system_simの3エージェントから移植し、参照先を要件書・design.md・本プロジェクトの
  ディレクトリ構成に合わせて書き換えた
- `.github/ISSUE_TEMPLATE/feature_request.md`：`issue-spec-reviewer`が前提とする6項目
  （概要／背景・目的／要件／対象範囲外／受け入れ条件／参考資料）のテンプレートを新設
- `.github/workflows/test.yml`：PR作成・更新時に型チェック・lint・ビルド・vitest・E2E＋a11yを実行
- `.github/workflows/deploy.yml`：`main`へのpushを契機にビルド・テストの上で`gh-pages`ブランチへ
  デプロイ（`peaceiris/actions-gh-pages`使用、production_system_simの`deploy.yml`とほぼ同一）
- `vite.config.ts`：GitHub Pages配信用のbaseパス切替（`npm run dev`はルート、`build`/`preview`は
  `/plm_systm_sim/`）をproduction_system_simと同じパターンで追加
- `playwright.config.ts`：E2Eの対象を`npm run dev`（ルート配信）に固定し、GitHub Pages用のbaseパスと
  衝突しないようにした（production_system_simと同じ理由）

production_system_simが導入している`pr-preview.yml`（PRごとのプレビュー配信）は、本プロジェクトの
現時点の規模ではオーバーヘッドが大きいと判断し見送った。導入する場合は`CLAUDE.md`の
「次にやるべきこと」候補を参照。

---

## 今後の候補

`CLAUDE.md`「次にやるべきこと（優先順）」の表を参照。着手前にユーザーへ優先順位を確認すること。

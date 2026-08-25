# PLMシミュレーター 設計書

**版数**: v1（要件書Rev.H 完全準拠版）
**目的**: PLMの中核概念（品目ライフサイクル、E-BOM／M-BOM、ECR→ECO→ECNの変更管理、PLM⇄生産管理
システムの連携）を、実際に操作しながら学べる教材とする
**位置づけ**: 本書は `PLM_simulator_requirements.md`（Rev.H、以下「要件書」）を実装仕様の一次資料とする
**差分ドキュメント**である。要件書が規定する業務ルール・データモデル・状態遷移・中核ロジックの疑似コード・
受入テストケース（8章のユースケース）はそのまま採用し、本書には次の2種類の情報のみを記載する。

1. 要件書が**未規定・疑似コードレベルの矛盾を含んだまま残した点への追加決定**（§2）
2. 本プロジェクト固有の**実装方針**（データモデル対応・画面構成・アーキテクチャ、§3〜§5）

業務ルールの背景・根拠（なぜその機能が必要か、PLMドメイン知識の詳細）を確認したいときは
`PLM_simulator_requirements.md` を参照すること。

## 0. 読み方

| 知りたいこと | 参照先 |
|---|---|
| 業務ルール（7ドメインの目的・データモデル・状態遷移・中核ロジックの疑似コード・ユースケース） | 要件書 3〜8章 |
| production_system_simとの連携シナリオ・SSOT競合検知の設計 | 要件書 9章 |
| UI方針・ガイドモーメントの台本 | 要件書 10章 |
| 「なぜこの実装なのか」「要件書の疑似コードだけでは動かない箇所はどう解決したか」 | 本書（design.md） |
| ファイル構成・コマンド・現在の実装状況 | `CLAUDE.md` |
| 実装フェーズの記録 | `docs/implementation-plan.md` |

## 姉妹リポジトリ `production_system_sim` との関係

`production_system_sim`は生産管理（受注〜出荷）のドメイン連携を学ぶ姉妹教材である。本リポジトリは
そのアーキテクチャ（React + TypeScript + Vite、バックエンドなし、`useReducer`による状態管理、
ドメインロジックを`src/domain/`配下にドメインごとのファイルへ分割する設計）を踏襲しつつ、
`production_system_sim`が意図的に実装していない概念（BOMのバージョニング・有効日・E-BOM/M-BOMの
系統分離・品目ライフサイクル）を正面から実装する、独立した新規プロジェクトである（要件書1.1・9.5）。
`production_system_sim`のドメインロジック・型定義は、`masterIO.ts`が入出力する`MasterSnapshot`と
直接互換な部分（`ItemMaster`・`BomLine`等）のみを型として継承し、それ以外は移植しない。

---

## §1 スコープ確認

要件書1.1〜1.3のスコープ宣言をそのまま採用する。要点の再掲：

- 本シミュレーターは、厳密には**PDM＋ECM相当**であり、原価企画・品質記録・サプライヤ管理まで含めた
  完全なPLMのスコープではない（要件書1.1、9.5に再掲）
- 教材製品は木製イス（基礎、要件書4.1）・自転車（応用、4階層BOM、4.2）・バリアント対応（4.4）・
  代替部品（4.5）の4シナリオ
- 連携方式はB案（疎結合・ファイルベース、`MasterSnapshot`互換JSON）に確定。production_system_sim側の
  改修は不要（要件書9.1・9.2）

---

## §2 要件書が未規定・疑似コードレベルの矛盾を含んだまま残した点への追加決定

要件書の疑似コード（7章）は概ねそのまま実装できる完成度だったが、実装時に次の点は具体化・修正が
必要だった。`production_system_sim`のdesign.mdにおける「EXT-N」に相当するものとして、
`PLM-EXT-N`として記録する。

| # | 論点 | 要件書の記述 | 追加決定 |
|---|---|---|---|
| PLM-EXT-1 | 「脚部ユニット」等のE-BOM限定機能グループを品目マスタに登録するか | 4.1は`EU-450`をBOM木の中で品目のように表記するが、5章の型定義上は品目マスタ（`PlmItem`）に登録すべきかは無規定 | **登録しない**。`EU-450`は`PlmBomLine.childItemId`／`parentItemId`として参照される文字列としてのみ存在し、`PlmItem`配列には現れない。`convertEbomToMbom()`が処理する時点でグループを参照する行はすべて消滅・再配置されるため、M-BOM側にもエクスポート先にも現れない。品目マスタに残すと、意味の無い「PLM専用ダミー品目」がエクスポート対象に紛れ込むリスクがある |
| PLM-EXT-2 | `isEbomOnly`フラグをBOM行のどちら側に立てるか | 7.2の`isEbomOnlyGroup(itemId, lines)`は`lines.some(l => l.parentItemId === itemId && l.isEbomOnly)`と定義されているが、4.1の図だけからは「親→グループ」の行と「グループ→子」の行のどちらにフラグを立てるべきか読み取れない | `isEbomOnlyGroup()`の実装をそのまま辿ると、**フラグは「グループ→子」の行（例：`EU-450→PT-400`）に立てる**必要があると判明した（「親→グループ」の行に立てると、`isEbomOnlyGroup(親品目)`が誤って真になり、他の子の変換が壊れる）。`presets.ts`のデータもこの規則に従う |
| PLM-EXT-3 | `resolveConfiguration()`の出力に`optionGroupId`が残るか | 7.2の`resolveConfiguration()`疑似コードは選択されなかった行を`filter`で除外するのみで、採用された行の`optionGroupId`/`optionCode`はそのまま残す。一方`convertEbomToMbom()`の前提コメントは「optionGroupIdを持つ行が残っていない」ことを要求する | 疑似コード間の矛盾と判断し、**`resolveConfiguration()`の`.map()`で採用行の`optionGroupId`/`optionCode`を`undefined`にクリアする**よう修正した（`ebom.ts`）。これにより`convertEbomToMbom()`の前提を満たせる |
| PLM-EXT-4 | バリアント解決後のBOM行を永続化するか | 要件書はバリアント解決を「1回の関数呼び出し」としてしか描いておらず、reducerでの状態管理方法（永続化するか、都度再計算するか）は無規定 | **永続化しない**。`variant/resolveConfiguration`アクションは新規品目の作成（必要な場合）と`Configuration`の記録のみを行い、`mbom/convert`アクションが呼ばれるたびに`resolveConfiguration()`→`convertEbomToMbom()`を都度実行する。解決済み行をBOM行として複製・保存する設計を最初に試みたが、テンプレート（150%BOM）と解決済み品目が同じ中間品（座面ASSY等）を共有する場合に子行が重複するバグに気づき、都度解決方式へ変更した |
| PLM-EXT-5 | 複数の確定品目を同一セッションで変換した場合のbomLineId衝突 | `convertEbomToMbom()`は`bomLineId: \`M-${line.bomLineId}\``と定義しており、同じE-BOMテンプレートから複数の構成（例：`FG-100`のデフォルトと`FG-101`の布張り）を変換すると、由来のE-BOM行IDが同じため`bomLineId`が衝突しうる | reducerの`mbom/convert`アクションで、`configuration`指定時のみ変換結果の`bomLineId`へ`-${resolvedItemId}`サフィックスを付与し、複数の確定品目を同一セッションで変換しても行IDが衝突しないようにした |
| PLM-EXT-6 | 代替部品の未承認選択をどこで拒否するか | 7.6の`resolveAlternates()`疑似コードは、`overrides`で明示的に選ばれた`childItemId`が承認済みかどうかを検証していない（デフォルト選択の算出でのみ承認済みに絞り込む）。一方UC-ALT-3は「未承認の代替品を選択しようとすると拒否される」ことを要求する | `resolveAlternates()`に、`overrides`で指定された`childItemId`が承認済み候補集合に含まれるかの検証を追加し、含まれなければ例外を投げるよう拡張した |
| PLM-EXT-7 | M-BOM未反映警告（UC-MBOM-3）の具体的な判定方法 | 「E-BOM側の変更が未反映のまま参照すると警告される」とあるのみで、判定関数の疑似コードは要件書に無い | `mbom.checkMbomStaleness()`を新規実装した。`convertEbomToMbom()`が`bomLineId: \`M-${元のbomLineId}\`\`という命名規則で変換元を辿れることを手がかりに、現在有効なE-BOM行のうち対応するM-BOM行が存在しないものを「未反映」として列挙する。バリアント解決（PLM-EXT-5のサフィックス付与）を経た変換では、この命名規則がずれるため判定の精度が落ちる既知の限界がある |
| PLM-EXT-8 | SSOT競合（`ConflictDetail`）の解決操作の具体的な実装方法 | 7.4の`preflightExport()`は競合を検出して提示するところまでで、「ユーザーが手動で解決する」（9.3）の具体的な状態遷移は無規定 | `sync/resolveConflict`アクションで、選択した解決（`ours`／`theirs`）に応じて**`SyncSession.baseline`を`theirs`の値へ進める**（＝競合の原因になった相手側の変更を「新しいベースライン」として受け入れたことにする）ことで、次回の`preflightExport()`実行時に同じキーが再び競合として現れないようにした。`theirs`採用時はPLM側の作業コピー（`items`/`bomLines`）も同時に上書きする |
| PLM-EXT-9 | 新規品目コードの確定はどの時点で行うか | 4.3の`generateNewItemCode()`は候補コードを1つ返す純粋関数だが、生成された候補をそのまま確定登録するのか、人間の確認を挟むのかは無規定 | UIでは「新しい品目コードを提案」ボタンで`generateNewItemCode()`を呼び出し、結果をテキスト入力欄へプリフィルするだけに留める。ユーザーが確認・上書きしてから送信する運用とし、確定登録（`item/create`または`variant/resolveConfiguration`ディスパッチ）は別操作にした |
| PLM-EXT-10 | アプリ初回起動時の状態 | 要件書はUC-SYNC-1（インポート）とUC-UI-1（初回オンボーディング＝木製イすのE-BOM構造がすでに見える）の両方を要求するが、両者の順序関係（起動直後は未インポート状態か、それとも整備済みか）は無規定 | **アプリの既定初期状態を「PLM側で既に整備済みの木製イすE-BOM」（脚部ユニット・座面バリアント・脚の代替部品グループを含む）として直接シードする**（`presets.createWoodenChairDemoState()`）。`MasterSnapshot`インポート機能（UC-SYNC-1）は連携タブから独立して使える別機能とし、「起動＝空でインポート待ち」にはしない。オンボーディングが即座に木製イすのE-BOM構造を見せられることを優先した |
| PLM-EXT-11 | `MasterSnapshot`インポート時のスキーマ検証の実装レベル | 5章の型コメントは「makeBuyは"MAKE"\|"BUY"のリテラル以外不可、leadTimeDaysは0以上の整数、qtyPerは正の数」という制約を文章で述べるのみで、検証関数自体は要件書に無い | `masterSnapshot.parseMasterSnapshot()`（フィールド単位、最初のエラーで即時中断）・`assertSnapshotUsable()`（主キー重複・BOM循環・参照整合性、全項目をまとめてから一括拒否）を新規実装した。9.4節が述べるproduction_system_sim側の「二層構造の検証」と同じ構造をPLM側のインポートにも適用している |
| PLM-EXT-12 | 影響分析タブでの原価影響（7.7）の見せ方 | `computeCostImpact()`はECOのbefore/after BOMを引数に取るが、UI側で「ECOごとのBOMスナップショットを保持する」具体的な仕組みは要件書に無い | 簡易版として、**代替部品グループのオーバーライド適用前後**（デフォルト優先順位のM-BOM vs 現在のオーバーライド適用後のM-BOM）を比較する形でUIに表示する。ECOごとのbefore/afterスナップショット管理は次のやるべきこと候補（CLAUDE.md参照）として先送りした |
| PLM-EXT-13 | 計画BOM・発注BOM（要件書のスコープ外の新規機能） | 要件書1.2「スコープ内」の7ドメインには存在しない、ユーザーからの要望に基づく新規スコープ拡張（Issue #8・#9） | 確定済みM-BOMを対象とした**読み取り専用の派生ビュー**として追加した。計画BOM（`domain/planningBom.ts`の`explodePlanningBom()`）はリードタイムを考慮した時系列所要展開（単一品目・単一数量のWhat-if限定、`resolveAlternates()`で代替部品グループを解決してから展開する）、発注BOM（`domain/impactAnalysis.ts`の`buildPurchaseBom()`）はBUY品目まで展開した購買集計ビュー（呼び出し側が`reducer.effectiveMbomLines()`で代替部品を解決済みのM-BOMを渡す前提）。いずれも`production_system_sim`側のトランザクション（計画オーダ・発注等）とは連携せず、PLM側のマスタから導出するだけの機能に限定し、要件書1.3・11章の「サプライヤ側の詳細プロセスはスコープ外」という方針は変更していない。UIは既存7タブとは独立した新規タブ「発注BOM」「計画BOM」として追加した |

---

## §3 データモデル対応・画面構成の実装対応

データモデル（`ItemMaster`/`BomLine`等の共有型、`PlmItem`/`PlmBomLine`等のPLM拡張、`EngineeringChange`・
`DesignDocument`・`SyncSession`・`ConflictDetail`等）は要件書5章の定義をそのまま`src/domain/types.ts`へ
落とした。要件書からの変更は無い。

| ドメイン（要件書3章） | 実装モジュール | 画面 |
|---|---|---|
| 品目（Item） | `domain/item.ts` | `ui/tabs/ItemsTab.tsx` |
| E-BOM | `domain/ebom.ts` | `ui/tabs/EbomTab.tsx`（バリアント構成解決フォームを含む） |
| M-BOM | `domain/mbom.ts` | `ui/tabs/MbomTab.tsx`（代替部品グループの選択を含む） |
| 変更管理（ECM） | `domain/changeManagement.ts` | `ui/tabs/ChangeManagementTab.tsx` |
| 文書・版数 | `domain/document.ts` | `ui/tabs/DocumentTab.tsx` |
| マスタ連携（Sync） | `domain/masterSnapshot.ts` | `ui/tabs/SyncTab.tsx` |
| 影響分析（Impact） | `domain/impactAnalysis.ts` | `ui/tabs/ImpactTab.tsx` |
| 発注BOM（Purchase、PLM-EXT-13） | `domain/impactAnalysis.ts`（`buildPurchaseBom()`） | `ui/tabs/PurchaseBomTab.tsx` |
| 計画BOM（Planning、PLM-EXT-13） | `domain/planningBom.ts` | `ui/tabs/PlanningBomTab.tsx` |

画面構成は要件書10.1（自由探索がデフォルト）・10.2（ガイドモーメント）に従い、7ドメインのタブ＋
`Onboarding.tsx`（初回起動時の5ステップガイド）というシンプルな2層構成にした。
`production_system_sim`のような「共通シェル／ドメイン画面／分析画面」の3層構成は、ドメイン数が
7つに収まり分析系の画面（影響分析）も1タブで完結するため採用していない。

---

## §4 アーキテクチャ（reducer action一覧）

`domain/reducer.ts`の`AppAction`判別共用体。呼び出し側（UI）は`dispatch(action)`のみを扱い、
実際のドメインロジックは各`domain/*.ts`モジュールの純粋関数（呼び出し側からは、という意味で。
内部は渡された配列を直接書き換える）へ委譲する。

| action | 委譲先 | 対応UC |
|---|---|---|
| `sync/import` | `masterSnapshot.importMasterSnapshotFromJson()` | UC-SYNC-1 |
| `item/create` / `item/advanceLifecycle` / `item/update` / `item/delete` | `item.ts` | UC-ITEM-1〜4 |
| `ebom/addLine` / `ebom/reviseLine` | `ebom.ts` | UC-EBOM-1〜3 |
| `variant/resolveConfiguration` | `item.createItem()`（必要時）＋`Configuration`記録 | UC-VARIANT-1・2 |
| `mbom/convert` | `ebom.resolveConfiguration()`（configuration指定時）→`mbom.convertEbomToMbom()` | UC-MBOM-1・2、UC-VARIANT-3 |
| `mbom/setAlternateOverride` | `mbom.resolveAlternates()`（検証のみ）＋オーバーライド記録 | UC-ALT-1〜3 |
| `change/create` 〜 `change/withdraw` | `changeManagement.ts` | UC-ECM-1〜9 |
| `document/register` / `document/revise` | `document.ts` | UC-DOC-1・2 |
| `sync/preflight` / `sync/resolveConflict` / `sync/confirmExport` | `masterSnapshot.preflightExport()`等 | UC-SYNC-2・3・7・8 |

BOM逆展開・原価影響（`whereUsed()`・`computeCostImpact()`）は状態を変更しない導出値のため、専用の
actionを持たず`ui/tabs/ImpactTab.tsx`が`domain/impactAnalysis.ts`を直接呼び出す
（`production_system_sim`の`AlertBar`等の「導出値には専用actionを持たせない」方針を踏襲）。

---

## §5 ディレクトリ構成

`src/domain/`・`src/ui/`配下の詳細なファイル一覧と各ファイルの役割は`CLAUDE.md`のディレクトリ構成に
まとめてある（本書との二重管理を避けるため、ここでは参照に留める）。

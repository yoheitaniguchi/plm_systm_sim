# PLMシミュレーター

`production_system_sim`（生産管理トレーニングシミュレーター）と対称的な設計の、PLM（正確にはPDM＋ECM相当）学習・検証用シミュレーターです。品目ライフサイクル、E-BOM／M-BOMの構造差、ECR→ECO→ECNの変更管理、PLM⇄生産管理システムのマスタ連携（MasterSnapshot互換JSON）を、木製イス／自転車の教材データを操作しながら学べます。

詳細な要件は `PLM_simulator_requirements.md`（Rev.H）を参照してください。

## セットアップ

```bash
npm install
npm run dev       # 開発サーバー
npm run build     # 本番ビルド（tsc -b && vite build）
npm run preview   # ビルド済みアプリのプレビュー
```

## テスト

```bash
npm test          # vitest（ドメインロジック単体テスト、42ユースケース相当）
npm run e2e       # Playwright + axe-core（E2E・アクセシビリティ）
npm run typecheck # tsc -b --noEmit
npm run lint      # eslint
```

## ディレクトリ構成

```
src/
  domain/
    types.ts             # 共有型定義（production_system_simと互換な型＋PLM拡張）
    item.ts               # 品目ライフサイクル
    ebom.ts                # E-BOM構造・版数・バリアント（オプショングループ）
    mbom.ts                # M-BOM構造・E→M変換・代替部品
    changeManagement.ts    # ECR/ECO/ECN状態遷移・承認集計
    document.ts            # 文書・版数
    masterSnapshot.ts      # MasterSnapshotの取り込み・書き出し・SSOT競合検知（3-wayマージ）
    impactAnalysis.ts      # BOM逆展開・影響分析・原価影響の簡易算出
    reducer.ts              # 全ドメインを束ねるreducer（useReducer用）
    presets.ts              # 教材用サンプルデータ（木製イス／自転車）
    __tests__/              # vitest
  ui/
    App.tsx                 # タブナビゲーション＋オンボーディング
    Onboarding.tsx           # 初回起動時の5ステップガイド
    tabs/                    # 7ドメインの画面
    components/              # BOMツリー等の共通コンポーネント
e2e/                         # Playwright + axe-core
```

## アーキテクチャ方針

- **状態管理**: `useReducer`。`reducer.ts` が `structuredClone` した状態を各ドメインモジュールへ渡し、モジュール側が直接書き換える（呼び出し側からは純粋関数として扱える）。
- **永続化**: なし。`production_system_sim` と同じく単一セッション・リロードで状態が消える設計。
- **マスタ連携**: `production_system_sim` の `masterIO.ts` が入出力する `MasterSnapshot` 形式のJSONをそのまま読み書きします（新規開発不要、疎結合・ファイルベース連携）。

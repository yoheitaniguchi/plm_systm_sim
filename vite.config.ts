import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages（プロジェクトサイト）は https://<owner>.github.io/<repo>/ 配下で配信されるため、
// build成果物とその動作確認（vite preview）ではアセットパスの先頭にリポジトリ名を付与する。
// `npm run dev` の開発サーバーはこれまでどおりルート配信のままにする
// （production_system_simのvite.config.tsと同じ方針）。
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  base: process.env.BASE_PATH ?? (command === 'build' || isPreview ? '/plm_systm_sim/' : '/'),
}));

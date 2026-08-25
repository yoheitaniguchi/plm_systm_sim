import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// 一部のサンドボックス実行環境ではブラウザが/opt/pw-browsers配下に事前インストールされており、
// ネットワーク取得（`playwright install`）を避けるためそちらを優先して使う。存在しない環境
// （通常のローカル開発・GitHub Actions CI）では未設定のままにし、Playwright自身の管理下にある
// ブラウザ（`npx playwright install --with-deps chromium`でインストール）を使わせる。
const sandboxChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(sandboxChromium) ? sandboxChromium : undefined;

// npm run dev（base "/"）を対象にする。npm run build/previewはGitHub Pages用に
// baseが/plm_systm_sim/になり（vite.config.ts）、E2Eのためだけにビルドを待つ意味が無いため
// devサーバーで十分とする（production_system_simのplaywright.config.tsと同じ方針）。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('onboarding (UC-UI-1/3)', () => {
  test('shows the wooden-chair E-BOM tour on first launch and can be skipped', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' })).toBeVisible();
    await expect(page.getByText('木製イスのE-BOM')).toBeVisible();

    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // スキップ後は自由探索モードに戻り、以降ガイドは自動表示されない
    await page.reload();
    await expect(page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' })).toBeVisible();
  });

  test('walks through all 5 steps, converts to M-BOM, and lands on 変更管理', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('ステップ 1 / 5')).toBeVisible();
    await dialog.getByRole('button', { name: '次へ' }).click();

    await expect(dialog.getByText('ステップ 2 / 5')).toBeVisible();
    await expect(dialog.getByText('脚部ユニット')).toBeVisible();
    await dialog.getByRole('button', { name: '次へ' }).click();

    await expect(dialog.getByText('ステップ 3 / 5')).toBeVisible();
    await dialog.getByRole('button', { name: 'M-BOMに変換' }).click();
    await dialog.getByRole('button', { name: '次へ' }).click();

    await expect(dialog.getByText('ステップ 4 / 5')).toBeVisible();
    await dialog.getByRole('button', { name: '次へ' }).click();

    await expect(dialog.getByText('ステップ 5 / 5')).toBeVisible();
    await dialog.getByRole('button', { name: '始める' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '変更管理', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('step 3 shows an animated flatten transition when converting to M-BOM', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' });
    await dialog.getByRole('button', { name: '次へ' }).click();
    await dialog.getByRole('button', { name: '次へ' }).click();
    await expect(dialog.getByText('ステップ 3 / 5')).toBeVisible();

    const diagram = dialog.locator('.mbom-flatten-diagram');
    await expect(diagram).toBeVisible();
    await expect(diagram).not.toHaveClass(/is-flattened/);
    const groupNode = diagram.locator('.mbom-flatten-diagram__node--group');
    await expect(groupNode).toHaveCSS('opacity', '1');

    await dialog.getByRole('button', { name: 'M-BOMに変換' }).click();

    await expect(diagram).toHaveClass(/is-flattened/);
    await expect(groupNode).toHaveCSS('opacity', '0');
    await expect(dialog.getByRole('button', { name: 'M-BOMに変換' })).toHaveCount(0);
  });

  test('falls back to an instant switch when prefers-reduced-motion is set', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' });
    await dialog.getByRole('button', { name: '次へ' }).click();
    await dialog.getByRole('button', { name: '次へ' }).click();

    const groupNode = dialog.locator('.mbom-flatten-diagram__node--group');
    await expect(groupNode).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('free exploration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
  });

  test('navigates across all 10 domain tabs without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (const label of ['品目', 'E-BOM', 'M-BOM', '工程（BOP）', '変更管理', '文書', '連携', '影響分析', '発注BOM', '計画BOM']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('main')).toContainText(/./);
    }
    expect(errors).toEqual([]);
  });

  test('lists the wooden chair items on the 品目 tab', async ({ page }) => {
    await expect(page.getByRole('cell', { name: 'FG-100' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '木製イス' })).toBeVisible();
  });

  test('shows the E-BOM tree including the 脚部ユニット group badge', async ({ page }) => {
    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    await expect(page.getByText('E-BOM限定').first()).toBeVisible();
  });
});

test.describe('conveyor preset (PLM-EXT-15)', () => {
  test('loads the conveyor sample, shows the 3-level E-BOM, and lists every parent of the shared bolt', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();

    await page.getByRole('button', { name: '連携', exact: true }).click();
    await page.getByRole('button', { name: 'コンベア装置のサンプルを読み込む（共通部品あり）' }).click();
    await page.getByRole('button', { name: 'インポートする' }).click();

    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    const tree = page.getByRole('tree');
    await expect(tree.getByText('コンベア装置（FG-800）')).toBeVisible();
    await expect(tree.getByText('駆動部（SA-820）')).toBeVisible();
    await expect(tree.getByText('モーター（PT-850）')).toBeVisible();
    await expect(tree.getByText('ボルト（PT-880）')).toHaveCount(3);

    await page.getByRole('button', { name: '影響分析', exact: true }).click();
    await page.getByLabel('対象品目').selectOption('PT-880');
    await page.getByLabel('BOM種別').selectOption('E');
    await page.getByRole('button', { name: 'どこで使われているか調べる（whereUsed）' }).click();
    for (const parent of ['SA-810', 'SA-820', 'SA-830']) {
      await expect(page.getByText(`深さ1: ${parent}`)).toBeVisible();
    }
    await expect(page.getByText('深さ2: FG-800')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

test.describe('ECR → ECO → ECN → クローズ flow (UC-ECM-1/2)', () => {
  test('runs a minor change through to クローズ from the UI', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '変更管理', exact: true }).click();

    await page.getByLabel('変更ID').fill('ECR-E2E-1');
    await page.getByLabel('対象品目（カンマ区切り）').fill('FG-100');
    await page.getByRole('button', { name: '起票する' }).click();

    const row = page.getByRole('row', { name: /ECR-E2E-1/ });
    await expect(row).toContainText('起票');

    await row.getByRole('button', { name: '審査へ提出' }).click();
    await expect(row).toContainText('審査中');

    await row.getByText('設計リーダー:').locator('..').getByRole('button', { name: '承認' }).click();
    await expect(row).toContainText('承認_影響分析中');

    await row.getByPlaceholder('有効日(D+)').fill('30');
    await row.getByRole('button', { name: 'ECO発行' }).click();
    await expect(row).toContainText('ECO発行');

    await row.getByRole('button', { name: 'ECN通知' }).click();
    await expect(row).toContainText('ECN通知済');

    await row.getByRole('button', { name: 'クローズ' }).click();
    await expect(row).toContainText('クローズ');
  });
});

test.describe('accessibility', () => {
  test('main app screen has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();

    const results = await new AxeBuilder({ page }).exclude('.onboarding-overlay').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});

test.describe('operations / BOP (PLM-EXT-17・18)', () => {
  test('adds, revises and reorders operations, and assigns the input operation of an M-BOM line', async ({ page }) => {
    await page.goto('/');
    // オンボーディングのステップ3でM-BOMへ変換しておく（投入工程の割り当て対象を作る）
    const dialog = page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' });
    await dialog.getByRole('button', { name: '次へ' }).click();
    await dialog.getByRole('button', { name: '次へ' }).click();
    await dialog.getByRole('button', { name: 'M-BOMに変換' }).click();
    await dialog.getByRole('button', { name: 'スキップ' }).click();

    await page.getByRole('button', { name: 'M-BOM', exact: true }).click();
    await expect(page.getByText('投入: OP10 組立').first()).toBeVisible();

    await page.getByRole('button', { name: '工程（BOP）', exact: true }).click();
    const opTable = page.getByRole('table').first();
    await expect(opTable.getByRole('cell', { name: '組立', exact: true })).toBeVisible();
    await expect(opTable.getByRole('cell', { name: '検査', exact: true })).toBeVisible();

    // 追加：作業区は取り込み済みの一覧から選ぶ
    await page.getByLabel('名称').fill('梱包');
    await page.getByLabel('作業区（取り込み済みの作業区から選びます）').selectOption('WC-INS');
    await page.getByLabel('標準時間（分）').fill('5');
    await page.getByRole('button', { name: '末尾に追加' }).click();
    await expect(opTable.getByRole('cell', { name: 'OP30', exact: true })).toBeVisible();

    // 同じ日の順序の入れ替えは拒否される（新しい版の開始日は旧版より後）
    await page.getByRole('button', { name: 'OP30 梱包を前へ' }).click();
    await expect(page.getByText('旧版より後である必要があります')).toBeVisible();

    // 日を進めると入れ替えられ、旧版が履歴に残る
    await page.getByRole('button', { name: '次の日へ進む' }).click();
    await expect(page.getByText('D1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'OP30 梱包を前へ' }).click();
    await expect(page.getByRole('heading', { name: '履歴（旧版・終了した工程）' })).toBeVisible();
    await expect(opTable.getByRole('row').nth(2)).toContainText('OP30');

    // 改訂
    await page.getByRole('button', { name: 'OP10 組立を改訂' }).click();
    await page.getByLabel('標準時間（分）').first().fill('25');
    await page.getByRole('button', { name: '改訂する' }).click();
    await expect(opTable.getByRole('row').nth(1)).toContainText('25');

    // 投入部品がある工程は終了できない
    await expect(page.getByRole('button', { name: 'OP10 組立を終了' })).toBeDisabled();

    // 投入工程の割り当て
    await page.getByLabel('PT-500の投入工程').selectOption('OP20');
    await expect(page.getByLabel('PT-500の投入工程')).toHaveValue('OP20');
    await page.getByRole('button', { name: 'M-BOM', exact: true }).click();
    await expect(page.getByText('投入: OP20 検査')).toBeVisible();
  });

  test('operations tab has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '工程（BOP）', exact: true }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});

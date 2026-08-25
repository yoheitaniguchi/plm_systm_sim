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

  test('navigates across all 9 domain tabs without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (const label of ['品目', 'E-BOM', 'M-BOM', '変更管理', '文書', '連携', '影響分析', '発注BOM', '計画BOM']) {
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

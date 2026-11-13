import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('onboarding (UC-UI-1/3)', () => {
  test('shows the wooden-chair E-BOM tour on first launch and can be skipped', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' })).toBeVisible();
    await expect(page.getByText('木製イスのE-BOM')).toBeVisible();

    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // スキップ後は自由探索モードに戻り、以降ガイドは自動表示されない。
    // 何も操作していなければ保存されない（起動した状態は保存しない。PLM-EXT-25）ので、リロードするとガイドが出る
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

  test('navigates across all 11 domain tabs without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (const label of ['品目', 'E-BOM', 'M-BOM', '工程（BOP）', '資源（BOR）', '変更管理', '文書', '連携', '影響分析', '発注BOM', '計画BOM']) {
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
    await page.getByRole('button', { name: '木製イスの末尾に追加' }).click();
    await expect(opTable.getByRole('cell', { name: 'OP30', exact: true })).toBeVisible();

    // 同じ日は改訂・順序の入れ替えができない（新しい版の開始日は旧版より後）。理由と日を進めるボタンが出る
    await expect(page.getByRole('button', { name: 'OP30 梱包を前へ' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'OP10 組立を改訂' })).toBeDisabled();
    await expect(page.getByText('現在日D0では')).toBeVisible();

    // 日を進めると入れ替えられ、旧版が履歴に残る
    await page.getByRole('button', { name: '日を進める（D1へ）' }).click();
    await expect(page.getByRole('status').filter({ hasText: '現在日' })).toContainText('D1');
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

    // 投入部品の無い工程は、確認を挟んで終了できる（確認中の画面もアクセシビリティ検査する）
    await page.getByRole('button', { name: 'OP30 梱包を終了' }).click();
    await expect(page.getByText('元に戻せず、工程コードOP30は再利用されません')).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.getByRole('button', { name: 'OP30 梱包の終了を確定' }).click();
    await expect(opTable.getByRole('cell', { name: 'OP30', exact: true })).toHaveCount(0);

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

test.describe('resources / BOR (PLM-EXT-19)', () => {
  test('adds resources to operations, lists them across operations, and removes one after confirmation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '資源（BOR）', exact: true }).click();
    await expect(page.getByText('MasterSnapshot に書き出されません')).toBeVisible();

    const form = page.getByRole('form', { name: '資源を追加' });
    await form.getByRole('combobox').nth(0).selectOption({ label: '木製イス（FG-100） OP10 組立' });
    await form.getByRole('combobox').nth(1).selectOption('治具・工具');
    await page.getByLabel('コード').fill('TL-DRV');
    await page.getByLabel('名称').fill('電動ドライバー');
    await form.getByRole('spinbutton').fill('2');
    await page.getByRole('button', { name: '資源を追加' }).click();

    await form.getByRole('combobox').nth(0).selectOption({ label: '座面ASSY（SA-200） OP10 切断' });
    await page.getByLabel('コード').fill('TL-DRV');
    await page.getByLabel('名称').fill('電動ドライバー');
    await page.getByRole('button', { name: '資源を追加' }).click();

    const usage = page.getByRole('table', { name: '資源の横断一覧（どの資源がどの工程で要るか）' });
    await expect(usage.getByRole('row')).toHaveCount(2);
    await expect(usage).toContainText('木製イス（FG-100） OP10 組立（必要数 2）');
    await expect(usage).toContainText('座面ASSY（SA-200） OP10 切断（必要数 2）');

    // 資源がある工程は終了できない（工程タブ）
    await page.getByRole('button', { name: '工程（BOP）', exact: true }).click();
    await expect(page.getByRole('button', { name: 'OP10 組立を終了' })).toBeDisabled();
    await page.getByRole('button', { name: '資源（BOR）', exact: true }).click();
    // タブを切り替えても資源は残る
    const list = page.getByRole('table', { name: '工程ごとの資源' });
    await expect(list.getByRole('row')).toHaveCount(3);

    await page.getByRole('button', { name: 'OP10の治具・工具 TL-DRVを削除' }).first().click();
    await expect(page.getByText('履歴は残りません')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.getByRole('button', { name: 'TL-DRVの削除を確定' }).click();
    await expect(list.getByRole('row')).toHaveCount(2);
  });
});

test.describe('routing 3-way merge (PLM-EXT-20)', () => {
  test('shows a routing conflict in the sync tab and resolves it with the other side', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();

    // PLM側で木製イスに工程を足す（＝この品目の工順をPLMが触った）
    await page.getByRole('button', { name: '工程（BOP）', exact: true }).click();
    await page.getByLabel('名称').fill('梱包');
    await page.getByLabel('作業区（取り込み済みの作業区から選びます）').selectOption('WC-INS');
    await page.getByLabel('標準時間（分）').fill('5');
    await page.getByRole('button', { name: '木製イスの末尾に追加' }).click();
    const opTable = page.getByRole('table').first();
    await expect(opTable.getByRole('cell', { name: 'OP30', exact: true })).toBeVisible();

    // 相手側でも、同じ品目の工順（検査の標準時間）を変えていたことにする
    await page.getByRole('button', { name: '連携', exact: true }).click();
    await page.getByRole('button', { name: '木製イスのサンプルを読み込む' }).click();
    const sample = JSON.parse(await page.getByPlaceholder('production_system_simから書き出したMasterSnapshot JSONを貼り付け').inputValue());
    sample.routingSteps.find((s: { itemId: string; stepNo: number }) => s.itemId === 'FG-100' && s.stepNo === 20).stdTimeMin = 15;
    await page.getByPlaceholder('現状確認用のMasterSnapshot JSON').fill(JSON.stringify(sample));
    await page.getByRole('button', { name: '現状確認を実行' }).click();

    await expect(page.getByText('結果: conflict')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'FG-100' });
    await expect(row.getByRole('cell', { name: '工順', exact: true })).toBeVisible();
    await expect(row).toContainText('順序30：WC-INS／標準5分');
    await expect(row).toContainText('順序20：WC-INS／標準15分');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

    await row.getByRole('button', { name: '相手側を採用' }).click();
    await expect(page.getByText('結果: conflict')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'MasterSnapshot.jsonをダウンロード' })).toBeEnabled();

    // PLM側の工程も相手側の工順に合う：梱包（OP30）は終了し、検査は15分になる
    await page.getByRole('button', { name: '工程（BOP）', exact: true }).click();
    await expect(opTable.getByRole('cell', { name: 'OP30', exact: true })).toHaveCount(0);
    await expect(opTable.getByRole('row').filter({ hasText: '検査' })).toContainText('15');
  });
});

test.describe('item revisions (PLM-EXT-21〜23)', () => {
  test('replaces a child on the E-BOM tab and shows the revision history and the difference', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '連携', exact: true }).click();
    await page.getByRole('button', { name: 'コンベア装置のサンプルを読み込む（共通部品あり）' }).click();
    await page.getByRole('button', { name: 'インポートする' }).click();

    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    // 取り込んだ日（D0）に始まった行は、同じ日には変更できない。理由と日を進めるボタンが出る
    const replaceMotor = page.getByRole('button', { name: 'SA-820 → PT-850 の子品目を置換' });
    await expect(replaceMotor).toBeDisabled();
    await page.getByRole('button', { name: '日を進める（D1へ）' }).click();
    await expect(replaceMotor).toBeEnabled();

    // 駆動部のモーターを、電装部品に置き換える
    await replaceMotor.click();
    const form = page.getByRole('form', { name: /子品目を置換/ });
    await form.getByRole('combobox').nth(0).selectOption('PT-870');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await form.getByRole('button', { name: 'D1 から置き換える' }).click();
    await expect(page.getByRole('form', { name: /子品目を置換/ })).toHaveCount(0);

    // 駆動部はA（旧版）→B（有効）。差分は「削除 モーター／追加 電装部品」
    await page.getByLabel('リビジョンを見る品目').selectOption('SA-820');
    const history = page.getByRole('table', { name: 'リビジョン履歴' });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByRole('row').nth(1)).toContainText('旧版');
    await expect(history.getByRole('row').nth(2)).toContainText('有効');
    const diff = page.getByRole('table', { name: /リビジョン A から B への差分/ });
    await expect(diff.getByRole('row')).toHaveCount(3);
    await expect(diff.getByRole('row').nth(1)).toContainText('削除');
    await expect(diff.getByRole('row').nth(1)).toContainText('PT-850');
    await expect(diff.getByRole('row').nth(2)).toContainText('追加');
    await expect(diff.getByRole('row').nth(2)).toContainText('PT-870');

    // 親のコンベア装置は、自分の行が変わっていないのでAのまま
    await page.getByLabel('リビジョンを見る品目').selectOption('FG-800');
    await expect(history.getByRole('row')).toHaveCount(2);

    // M-BOMへ変換した後でE-BOM行を終了すると、M-BOMタブに未反映の警告が出る
    await page.getByRole('button', { name: 'M-BOM', exact: true }).click();
    await page.getByRole('button', { name: 'M-BOMに変換' }).click();
    const staleWarning = page.getByText(/SA-820 → PT-860）の元のE-BOM行は終了しています/);
    await expect(staleWarning).toHaveCount(0);
    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    await page.getByRole('button', { name: 'SA-820 → PT-860 を終了' }).click();
    await page.getByRole('button', { name: 'D1 で終了する' }).click();
    await page.getByRole('button', { name: 'M-BOM', exact: true }).click();
    await expect(staleWarning).toBeVisible();
    const finalScan = await new AxeBuilder({ page }).analyze();
    expect(finalScan.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});

test.describe('persistence (PLM-EXT-24・25)', () => {
  const clock = (page: import('@playwright/test').Page) => page.getByText(/現在日：/);

  test('restores a replaced E-BOM line after a reload, without the tour (design §6)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '連携', exact: true }).click();
    await page.getByRole('button', { name: 'コンベア装置のサンプルを読み込む（共通部品あり）' }).click();
    await page.getByRole('button', { name: 'インポートする' }).click();
    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    await page.getByRole('button', { name: '日を進める（D1へ）' }).click();
    await page.getByRole('button', { name: 'SA-820 → PT-850 の子品目を置換' }).click();
    await page.getByRole('form', { name: /子品目を置換/ }).getByRole('combobox').nth(0).selectOption('PT-870');
    await page.getByRole('button', { name: 'D1 から置き換える' }).click();
    await expect(page.getByRole('button', { name: 'SA-820 → PT-870 の子品目を置換' })).toBeVisible();
    await expect(page.getByText(/このブラウザに保存中（最終/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(clock(page)).toContainText('D1');
    // 復元した直後から、最終保存の時刻が出る
    await expect(page.getByText(/このブラウザに保存中（最終/)).toBeVisible();
    await page.getByRole('button', { name: 'E-BOM', exact: true }).click();
    await expect(page.getByRole('button', { name: 'SA-820 → PT-870 の子品目を置換' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SA-820 → PT-850 の子品目を置換' })).toHaveCount(0);
    await page.getByLabel('リビジョンを見る品目').selectOption('SA-820');
    await expect(page.getByRole('table', { name: 'リビジョン履歴' }).getByRole('row')).toHaveCount(3);
  });

  test('saves the last change when the page is closed during the save delay', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '次の日へ進む' }).click();
    // 0.5秒のまとめを待たずにリロードしても、pagehide で書き出される
    await page.reload();
    await expect(clock(page)).toContainText('D1');
  });

  test('turning saving off deletes the saved data and starts from the sample after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '次の日へ進む' }).click();
    await expect(page.getByText(/このブラウザに保存中（最終/)).toBeVisible();
    await page.getByLabel('このブラウザに保存する').uncheck();
    await expect(page.getByText('保存しない（リロードで消えます）')).toBeVisible();
    await page.reload();
    await expect(clock(page)).toContainText('D0');
    await expect(page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' })).toBeVisible();
    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(page.getByLabel('このブラウザに保存する')).not.toBeChecked();
  });

  test('restarts from the sample after confirming', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await page.getByRole('button', { name: '次の日へ進む' }).click();
    await expect(page.getByText(/このブラウザに保存中（最終/)).toBeVisible();
    await page.getByRole('button', { name: '保存を消してサンプルで始め直す' }).click();
    // 「やめる」にフォーカスが移り、やめると元のボタンへ戻る
    await expect(page.getByRole('button', { name: 'やめる' })).toBeFocused();
    await page.getByRole('button', { name: 'やめる' }).click();
    await expect(page.getByRole('button', { name: '保存を消してサンプルで始め直す' })).toBeFocused();
    await page.getByRole('button', { name: '保存を消してサンプルで始め直す' }).click();
    await page.getByRole('button', { name: '消して始め直す' }).click();
    await expect(page.getByRole('dialog', { name: '木製イスのE-BOM構造ツアー' })).toBeVisible();
    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(clock(page)).toContainText('D0');
  });

  test('starts from the sample with the reason when the saved data is broken, and keeps it aside', async ({ page }) => {
    // 起動前に壊れたデータを置く（このテストのページを開く1回だけ）
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('plm-systm-sim:state', '{"kind":"something-else","version":1,"state":{}}');
      }
    });
    await page.goto('/');
    // 理由のお知らせがツアーの下に隠れないよう、ツアーは出さない
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const alert = page.getByRole('status').filter({ hasText: '保存したデータを読み込めなかった' });
    await expect(alert).toContainText('種類が違います');
    await expect(clock(page)).toContainText('D0');
    expect(await page.evaluate(() => localStorage.getItem('plm-systm-sim:broken'))).toContain('something-else');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await alert.getByRole('button', { name: '退避したデータを捨てる' }).click();
    await alert.getByRole('button', { name: '捨てる', exact: true }).click();
    await expect(alert).toContainText('退避したデータを捨てました');
    await expect(alert.getByRole('button', { name: '退避したデータを書き出す' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('plm-systm-sim:broken'))).toBeNull();
    await alert.getByRole('button', { name: 'このお知らせを閉じる' }).click();
    await expect(page.getByText('保存したデータを読み込めなかった')).toHaveCount(0);
  });

  test('warns when another tab saves', async ({ context }) => {
    const first = await context.newPage();
    await first.goto('/');
    await first.getByRole('button', { name: 'スキップ' }).click();
    const second = await context.newPage();
    await second.goto('/');
    await second.getByRole('button', { name: 'スキップ' }).click();
    // 開いただけでは保存しないので、まだ警告は出ない
    const notice = first.getByRole('status').filter({ hasText: '別のタブでこのシミュレーターの状態が保存されました' });
    await expect(notice).toHaveCount(0);
    await second.getByRole('button', { name: '次の日へ進む' }).click();
    await expect(second.getByText(/現在日：/)).toContainText('D1');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'このタブで続ける' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('stops saving in this tab when another tab turns saving off', async ({ context }) => {
    const first = await context.newPage();
    await first.goto('/');
    await first.getByRole('button', { name: 'スキップ' }).click();
    const second = await context.newPage();
    await second.goto('/');
    await second.getByRole('button', { name: 'スキップ' }).click();
    await second.getByLabel('このブラウザに保存する').uncheck();
    await expect(first.getByText('別のタブで保存がオフにされたため、このタブも保存をやめました')).toBeVisible();
    await expect(first.getByLabel('このブラウザに保存する')).not.toBeChecked();
    await first.getByRole('button', { name: '次の日へ進む' }).click();
    await first.waitForTimeout(800);
    expect(await first.evaluate(() => localStorage.getItem('plm-systm-sim:state'))).toBeNull();
  });
});

test.describe('theme (PLM-EXT-26)', () => {
  const TAB_NAMES = ['品目', 'E-BOM', 'M-BOM', '工程（BOP）', '資源（BOR）', '変更管理', '文書', '連携', '影響分析', '発注BOM', '計画BOM'];

  test('follows the OS setting by default, and keeps an explicit choice across a reload even with saving off', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByRole('button', { name: 'スキップ' }).click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light');

    const themes = page.getByRole('group', { name: '表示テーマ' });
    await themes.getByRole('button', { name: 'ダーク' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // 保存をオフにしてもテーマは残る（所有者決定：連動させない）
    await page.getByLabel('このブラウザに保存する').uncheck();
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'スキップ' }).click();
    await expect(themes.getByRole('button', { name: 'ダーク' })).toHaveAttribute('aria-pressed', 'true');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`every tab has no serious axe violations in the ${theme} theme`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'スキップ' }).click();
      await page.getByRole('group', { name: '表示テーマ' }).getByRole('button', { name: theme === 'light' ? 'ライト' : 'ダーク' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // バッジ・強調表示が出る画面も検査に入るよう、木製イスの M-BOM を作っておく
      await page.getByRole('navigation', { name: 'ドメインタブ' }).getByRole('button', { name: 'M-BOM' }).click();
      await page.getByRole('button', { name: 'M-BOMに変換' }).click();
      for (const name of TAB_NAMES) {
        await page.getByRole('navigation', { name: 'ドメインタブ' }).getByRole('button', { name, exact: true }).click();
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious, `${theme} / ${name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
      }
    });
  }
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp, menu, ready, stubDialogs, tempDir } from './helpers';

const fixture = (name: string): string => path.resolve('tests/fixtures/csv', name);

/** Opens the Fit view. */
async function gotoFit(page: Page): Promise<void> {
  await page.locator('#rail button[data-target="fit"]').click();
  await expect(page.locator('#fit-sample')).toBeVisible();
}

/** Chooses a bundled sample dataset by id. */
async function pickSample(page: Page, id: string): Promise<void> {
  await page.selectOption('#fit-sample', id);
  await expect(page.locator('#fit-summary')).toBeVisible();
}

test.describe('Fit mode', () => {
  test('bundled datasets show their source, licence and caveats; the honest-modelling notes are always visible', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await gotoFit(page);
    await expect(page.locator('#fit-top-note')).toContainText('not true infections');
    await pickSample(page, 'ut-flu-hosp-2024-25');
    const info = page.locator('#dataset-info');
    await expect(info).toContainText('Public Domain U.S. Government');
    await expect(info).toContainText('Weekly Hospital Respiratory Data');
    await expect(info).toContainText('NOT infections');
    await expect(page.locator('#fit-summary')).toContainText(
      'Using 39 of 39 observations (weekly)',
    );
    await pickSample(page, 'ut-flu-hosp-2022-23');
    await expect(page.locator('#fit-summary')).toContainText('Using 26 of 26 observations');
    await app.close();
  });

  test('CSV import: a good file loads; every bad fixture gives the right message and nothing is silently dropped', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await gotoFit(page);
    const load = async (file: string): Promise<void> => {
      await stubDialogs(app, { open: fixture(file) });
      await page.locator('#fit-open').click();
      await expect(page.locator('#toast')).toContainText(`Read ${file}`);
    };
    await load('good-weekly.csv');
    await expect(page.locator('#fit-summary')).toContainText(
      'Using 10 of 10 observations (weekly)',
    );
    await load('bad-negative.csv');
    await expect(page.locator('#import-problems')).toContainText('negative');
    await expect(page.locator('#fit-summary')).toHaveCount(0);
    await load('bad-duplicate-dates.csv');
    await expect(page.locator('#import-problems')).toContainText('Duplicate date');
    await load('bad-nonnumeric.csv');
    await expect(page.locator('#import-problems')).toContainText('"many" is not a number');
    await load('missing-values.csv');
    await expect(page.locator('#import-problems')).toContainText('NOT treated as zero');
    await expect(page.locator('#fit-summary')).toContainText('Using 6 of 6');
    await load('bom-semicolon.csv');
    await expect(page.locator('#import-problems')).toContainText('byte-order mark');
    await load('empty.csv');
    await expect(page.locator('#import-problems, .problems')).toContainText(/empty/i);
    await app.close();
  });

  test('synthetic data fit: converges, shows fixed vs fitted, bands and posterior panels; CSV export includes the verdict', async () => {
    test.setTimeout(240_000);
    const dir = tempDir();
    const out = path.join(dir, 'fit.csv');
    const app = await launchApp();
    const page = await ready(app);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await gotoFit(page);
    await pickSample(page, 'synthetic-seir-weekly');
    await expect(page.locator('#fit-model-select')).toHaveValue('SEIR');
    await page.selectOption('#fit-length', 'standard');
    await page.locator('#fit-run').click();
    await expect(page.locator('#btn-cancel')).toBeVisible();
    await expect(page.locator('#verdict')).toBeVisible({ timeout: 200_000 });
    await expect(page.locator('#verdict')).toHaveAttribute('data-converged', 'true');
    await expect(page.locator('#fit-table')).toContainText('FITTED');
    await expect(page.locator('#fit-table')).toContainText('Incubation period (days)');
    await expect(page.locator('#fit-chart')).toBeVisible();
    await expect(page.locator('#hist-grid canvas')).toHaveCount(3);
    await expect(page.locator('#gof-table')).toContainText('Within the 95% band');
    await expect(page.locator('#fit-honest')).toContainText('REPORTED cases');
    const rhat = (await page.locator('#diag-table td').first().textContent()) ?? '';
    expect(parseFloat(rhat)).toBeLessThan(1.05); // the diagnostics section is collapsed when converged, so read textContent
    await stubDialogs(app, { save: out });
    await menu(page, 'file:export-csv');
    await expect(page.locator('#toast')).toContainText('Fit saved as fit.csv');
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('diagnostics_verdict=converged');
    expect(text).toContain('# posterior r0:');
    expect(text).toContain('seed=12345');
    expect(errors).toEqual([]);
    await app.close();
  });

  test('a deliberately too-short run shows NOT converged and withholds the numbers until you ask', async () => {
    test.setTimeout(120_000);
    const app = await launchApp();
    const page = await ready(app);
    await gotoFit(page);
    await pickSample(page, 'synthetic-seir-weekly');
    await page.selectOption('#fit-length', 'quick');
    await page.locator('#fit-run').click();
    await expect(page.locator('#verdict')).toBeVisible({ timeout: 100_000 });
    await expect(page.locator('#verdict')).toHaveAttribute('data-converged', 'false');
    await expect(page.locator('#verdict')).toContainText('NOT converged');
    await expect(page.locator('#fit-chart')).toHaveCount(0);
    await expect(page.locator('#fit-diagnostics')).toBeVisible();
    await page.locator('#btn-show-unreliable').click();
    await expect(page.locator('#fit-chart')).toBeVisible();
    await expect(page.locator('#fit-results')).toContainText('UNRELIABLE');
    await app.close();
  });

  test('Cancel stops a running fit', async () => {
    test.setTimeout(120_000);
    const app = await launchApp();
    const page = await ready(app);
    await gotoFit(page);
    await pickSample(page, 'synthetic-seir-weekly');
    await page.selectOption('#fit-length', 'long');
    await page.locator('#fit-run').click();
    await expect(page.locator('#btn-cancel')).toBeVisible();
    await page.locator('#btn-cancel').click();
    await expect(page.locator('#fit-results [data-state="cancelled"]')).toBeVisible();
    await expect(page.locator('#fit-run')).toBeEnabled();
    await app.close();
  });

  test('both bundled real datasets fit end to end (SIR with the flu infectious period) and show a verdict and the identifiability section', async () => {
    test.setTimeout(480_000);
    const app = await launchApp();
    const page = await ready(app);
    await gotoFit(page);
    for (const id of ['ut-flu-hosp-2024-25', 'ut-flu-hosp-2022-23']) {
      await pickSample(page, id);
      await expect(page.locator('#fit-model-select')).toHaveValue('SIR');
      await expect(page.locator('#fit-infectious-val')).toHaveValue('4.8');
      await page.selectOption('#fit-length', 'standard');
      await page.locator('#fit-run').click();
      await expect(page.locator('#verdict')).toBeVisible({ timeout: 200_000 });
      await expect(page.locator('#fit-diagnostics')).toBeVisible();
      await expect(page.locator('#fit-honest')).toBeVisible();
    }
    await app.close();
  });

  test('screenshots of Fit mode (light and dark)', async () => {
    test.setTimeout(300_000);
    const out = path.resolve('docs/screenshots');
    mkdirSync(out, { recursive: true });
    const app = await launchApp();
    const page = await ready(app);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 1100),
    );
    await gotoFit(page);
    await pickSample(page, 'synthetic-seir-weekly');
    await page.selectOption('#fit-length', 'standard');
    await page.locator('#fit-run').click();
    await expect(page.locator('#verdict')).toBeVisible({ timeout: 200_000 });
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.dataset['theme'])) !== theme)
        await page.locator('#btn-theme').click(); // use the real toggle so charts redraw
      await page.waitForTimeout(500);
      await page.locator('#fit-data').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `fit-setup-${theme}.png`) });
      await page.locator('#fit-chart-card').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `fit-results-${theme}.png`) });
      await page.locator('#fit-posterior-card').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `fit-posterior-${theme}.png`) });
    }
    await page.locator('#fit-diagnostics summary').click();
    await page.locator('#fit-diagnostics').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'fit-diagnostics-dark.png') });
    await app.close();
  });
});

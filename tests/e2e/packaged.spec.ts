import { _electron as electron, expect, test } from '@playwright/test';
import { fmtInt } from '../../src/ui/format';
import { runScenario } from '../../src/sim/scenario';
import { defaultScenario } from '../../src/ui/store';
import { stat, tempDir } from './helpers';

// Runs against an installed/unpacked build when PACKAGED_APP points at its executable (see README); skipped otherwise.
const exe = process.env['PACKAGED_APP'];

test.describe('packaged app', () => {
  test.skip(exe === undefined, 'set PACKAGED_APP to the packaged executable to run these');

  test('launches, simulates, and completes a small fit using the bundled datasets', async () => {
    test.setTimeout(180_000);
    const app = await electron.launch({
      executablePath: exe ?? '',
      env: { ...process.env, OUTBREAKSCOPE_HIDDEN: '1', OUTBREAKSCOPE_USER_DATA: tempDir() },
    });
    const page = await app.firstWindow();
    await page.locator('#check-worker').waitFor({ state: 'attached' });
    await expect(page.locator('#check-worker')).toHaveAttribute('data-ok', 'true');
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
    await expect(page).toHaveTitle('OutbreakScope');
    const base = runScenario(defaultScenario());
    if (!base.ok) throw new Error('valid');
    expect(await stat(page, 'Peak infectious')).toBe(fmtInt(base.result.numbers.peakInfectious));
    await page.locator('#tab-stochastic').click();
    await page.locator('#btn-run').click();
    await expect(page.locator('#fizzle-panel')).toBeVisible({ timeout: 60_000 });
    await page.locator('#rail button[data-target="fit"]').click();
    await page.selectOption('#fit-sample', 'ut-flu-hosp-2022-23');
    await expect(page.locator('#dataset-info')).toContainText('Public Domain U.S. Government');
    await page.selectOption('#fit-length', 'quick');
    await page.locator('#fit-run').click();
    await expect(page.locator('#verdict')).toBeVisible({ timeout: 120_000 });
    await app.close();
  });
});

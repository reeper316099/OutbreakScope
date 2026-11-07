import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseScenarioFile } from '../../src/io/session';
import { fmtInt, fmtPct, fmtSig } from '../../src/ui/format';
import { runScenario } from '../../src/sim/scenario';
import { defaultScenario } from '../../src/ui/store';
import { launchApp, menu, ready, setField, stat, stubDialogs, tempDir } from './helpers';

/** Expected key numbers computed directly with the unit-tested simulation code. */
function expected(over: Partial<ReturnType<typeof defaultScenario>['params']> = {}) {
  const s = defaultScenario();
  s.params = { ...s.params, ...over };
  const out = runScenario(s);
  if (!out.ok) throw new Error('scenario should be valid');
  return out.result.numbers;
}

test.describe('Scenario mode', () => {
  test('key numbers match the unit-tested values; changing R0 updates them', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const base = expected();
    await expect(page.locator('[data-stat="Peak infectious"]')).toBeVisible();
    expect(await stat(page, 'Peak infectious')).toBe(fmtInt(base.peakInfectious));
    expect(await stat(page, 'Final size')).toBe(fmtPct(base.attackRate));
    expect(await stat(page, 'Herd immunity threshold')).toBe(fmtPct(base.herdImmunityThreshold));
    await setField(page, 'r0', 4);
    const r4 = expected({ r0: 4 });
    await expect.poll(() => stat(page, 'Peak infectious')).toBe(fmtInt(r4.peakInfectious));
    expect(await stat(page, 'Early growth rate')).toBe(`${fmtSig(r4.growthRate, 3)} per day`);
    expect(await stat(page, 'Herd immunity threshold')).toBe('75%');
    expect(errors).toEqual([]);
    await app.close();
  });

  test('invalid values show friendly messages instead of results; undo restores them', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await setField(page, 'population', 0);
    await expect(page.locator('#sim-error')).toBeVisible();
    await expect(page.locator('#sim-error')).toContainText('population');
    await page.locator('#btn-undo').click();
    await expect(page.locator('#sim-error')).toBeHidden();
    await expect(page.locator('[data-stat="Peak infectious"]')).toBeVisible();
    await app.close();
  });

  test('adding an intervention shows it on the timeline and lowers the peak; vaccination needs the SEIR+V model', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const before = await stat(page, 'Peak infectious');
    await expect(page.locator('#btn-add-vax')).toBeDisabled();
    await page.locator('#btn-add-contact').click();
    await expect(page.locator('#timeline-strip .tl-contact')).toHaveCount(1);
    await expect.poll(() => stat(page, 'Peak infectious')).not.toBe(before);
    const s = defaultScenario();
    s.interventions = [{ type: 'contact_reduction', startDay: 30, endDay: 365, strength: 0.4 }];
    const out = runScenario(s);
    if (!out.ok) throw new Error('valid');
    expect(await stat(page, 'Peak infectious')).toBe(fmtInt(out.result.numbers.peakInfectious));
    await page.selectOption('#model-select', 'SEIRV');
    await expect(page.locator('#btn-add-vax')).toBeEnabled();
    await page.locator('#btn-add-vax').click();
    await expect(page.locator('#timeline-strip .tl-vax')).toHaveCount(1);
    await expect(page.locator('[data-stat="Total vaccinated"]')).toBeVisible();
    await app.close();
  });

  test('stochastic run is reproducible from the seed, and Cancel stops a long run', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await setField(page, 'population', 5000);
    await setField(page, 'initialInfected', 5);
    await setField(page, 'ensembleSize', 60);
    await page.locator('#tab-stochastic').click();
    const run = async (): Promise<string> => {
      await page.locator('#btn-run').click();
      await expect(page.locator('#ens-state [data-state="done"], #ens-state p')).toContainText(
        'Finished 60 runs',
      );
      await page.locator('#chart-ens').hover({ position: { x: 120, y: 60 } });
      await page.locator('#chart-ens').hover({ position: { x: 300, y: 100 } });
      return `${await page.locator('#fizzle-panel').innerText()}\n${await page.locator('#ens-readout').innerText()}`;
    };
    const first = await run();
    const second = await run();
    expect(second).toBe(first);
    expect(first).toMatch(/fizzled out/);
    // Cancel mid-run: many Gillespie runs take a few seconds.
    await setField(page, 'population', 20000);
    await setField(page, 'initialInfected', 20);
    await setField(page, 'ensembleSize', 1000);
    await page.locator('#btn-run').click();
    await expect(page.locator('#btn-cancel')).toBeVisible();
    await page.locator('#btn-cancel').click();
    await expect(page.locator('#ens-state [data-state="cancelled"]')).toBeVisible();
    await app.close();
  });

  test('save, restart, open gives identical results; corrupted and newer-version files give friendly errors', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'scenario.json');
    let app = await launchApp();
    let page = await ready(app);
    await setField(page, 'r0', 3.3);
    await page.locator('#btn-add-contact').click();
    const sc = defaultScenario();
    sc.params.r0 = 3.3;
    sc.interventions = [{ type: 'contact_reduction', startDay: 30, endDay: 365, strength: 0.4 }];
    const exp = runScenario(sc);
    if (!exp.ok) throw new Error('valid');
    const peak = fmtInt(exp.result.numbers.peakInfectious);
    await expect.poll(() => stat(page, 'Peak infectious')).toBe(peak);
    await stubDialogs(app, { save: file });
    await menu(page, 'file:save-scenario');
    await expect(page.locator('#toast')).toContainText('Scenario saved as scenario.json');
    await app.close();
    const saved = parseScenarioFile(readFileSync(file, 'utf8'));
    expect(saved.ok).toBe(true);

    app = await launchApp();
    page = await ready(app);
    await stubDialogs(app, { open: file });
    await menu(page, 'file:open-scenario');
    await expect(page.locator('#toast')).toContainText('Opened scenario.json');
    await expect.poll(() => stat(page, 'Peak infectious')).toBe(peak);
    await expect(page.locator('#f-r0')).toHaveValue('3.3');

    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    await stubDialogs(app, { open: bad });
    await menu(page, 'file:open-scenario');
    await expect(page.locator('#toast')).toContainText('not valid JSON');
    const newer = path.join(dir, 'newer.json');
    writeFileSync(
      newer,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), formatVersion: 99 }),
    );
    await stubDialogs(app, { open: newer });
    await menu(page, 'file:open-scenario');
    await expect(page.locator('#toast')).toContainText('newer version');
    await expect.poll(() => stat(page, 'Peak infectious')).toBe(peak); // failed opens change nothing
    await app.close();
  });

  test('CSV and PNG exports go through the save-dialog path with the documented header', async () => {
    const dir = tempDir();
    const csv = path.join(dir, 'out.csv');
    const png = path.join(dir, 'out.png');
    const app = await launchApp();
    const page = await ready(app);
    await setField(page, 'r0', 2.8);
    await stubDialogs(app, { save: csv });
    await menu(page, 'file:export-csv');
    await expect(page.locator('#toast')).toContainText('CSV saved as out.csv');
    const text = readFileSync(csv, 'utf8');
    expect(text).toContain('# OutbreakScope');
    expect(text).toContain('R0=2.8');
    expect(text).toContain('seed=12345');
    expect(text.split('\n').filter((l) => /^\d/.test(l)).length).toBe(366);
    await stubDialogs(app, { save: png });
    await menu(page, 'file:export-png');
    await expect(page.locator('#toast')).toContainText('Chart saved as out.png');
    const sig = readFileSync(png).subarray(0, 8).toString('hex');
    expect(sig).toBe('89504e470d0a1a0a');
    await app.close();
  });

  test('scenario comparison highlights differences', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await page.locator('#tab-compare').click();
    await page.locator('#save-A').click();
    await page.locator('#btn-add-contact').click();
    await page.locator('#save-B').click();
    await expect(page.locator('#compare-table')).toBeVisible();
    await expect(page.locator('#compare-table td.diff').first()).toBeVisible();
    await expect(page.locator('#compare-summary')).toContainText(/peak reduced by \d+%/);
    await app.close();
  });

  test('explainer renders MathML and the RK4 demo steps through', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await page.locator('#rail button[data-target="explainer"]').click();
    const math = page.locator('#view-explainer math');
    expect(await math.count()).toBeGreaterThan(3);
    const h = await math.first().evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThan(10);
    await expect(page.locator('#view-explainer')).toContainText('worked example');
    for (let i = 0; i < 5; i++) await page.locator('#rk4-next').click();
    await expect(page.locator('#rk4-text')).toContainText('Blend');
    await app.close();
  });

  test('dark mode works and persists across restarts', async () => {
    const dir = tempDir();
    let app = await launchApp(dir);
    let page = await ready(app);
    const initial = await page.evaluate(() => document.documentElement.dataset['theme']);
    await page.locator('#btn-theme').click();
    const toggled = await page.evaluate(() => document.documentElement.dataset['theme']);
    expect(toggled).not.toBe(initial);
    await app.close();
    app = await launchApp(dir);
    page = await ready(app);
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(toggled);
    await app.close();
  });

  test('screenshots (light and dark) of each main view', async () => {
    const out = path.resolve('docs/screenshots');
    mkdirSync(out, { recursive: true });
    const app = await launchApp();
    const page = await ready(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
    await page.locator('#btn-add-contact').click();
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.dataset['theme'])) !== theme)
        await page.locator('#btn-theme').click(); // use the real toggle so charts redraw
      await page.locator('#rail button[data-target="simulator"]').click();
      await page
        .locator('#btn-add-contact')
        .click()
        .catch(() => undefined);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `simulator-${theme}.png`) });
      await page.locator('#tab-incidence').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `incidence-${theme}.png`) });
      await page.locator('#tab-reff').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `reff-${theme}.png`) });
      await page.locator('#tab-stochastic').click();
      await page.locator('#btn-run').click();
      await expect(page.locator('#fizzle-panel')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `stochastic-${theme}.png`) });
      await page.locator('#tab-compare').click();
      await page.locator('#save-A').click();
      await setField(page, 'r0', 1.8);
      await page.locator('#save-B').click();
      await setField(page, 'r0', 2.5);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `compare-${theme}.png`) });
      await page.locator('#rail button[data-target="explainer"]').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `explainer-${theme}.png`), fullPage: false });
      await page.locator('#rail button[data-target="about"]').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `about-${theme}.png`) });
    }
    await app.close();
  });
});

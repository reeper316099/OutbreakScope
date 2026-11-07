import { expect, test } from '@playwright/test';
import { launchApp, ready, setField } from './helpers';

// Measures responsiveness: long main-thread tasks (> 50 ms) during live slider updates, a 1000-run stochastic ensemble at N = 1,000,000, and a full fit.
test('UI stays responsive during heavy work; timings are reported', async () => {
  test.setTimeout(300_000);
  const app = await launchApp();
  const page = await ready(app);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => w.__long.push(e.duration)),
    ).observe({ entryTypes: ['longtask'] });
  });
  const longTasks = (): Promise<number[]> =>
    page.evaluate(() => (window as unknown as { __long: number[] }).__long.slice());
  // 1. live slider updates (each key press recomputes the deterministic solution and redraws all charts)
  await page.locator('#f-r0-slider').focus();
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => Number(await page.locator('#f-r0').inputValue()))
    .toBeGreaterThan(4);
  const sliderMs = (Date.now() - t0) / 40;
  // 2. ensemble: 1000 realizations, N = 1,000,000
  await setField(page, 'population', 1_000_000);
  await setField(page, 'initialInfected', 20);
  await setField(page, 'ensembleSize', 1000);
  await page.locator('#tab-stochastic').click();
  const t1 = Date.now();
  await page.locator('#btn-run').click();
  await expect(page.locator('#fizzle-panel')).toBeVisible({ timeout: 120_000 });
  const ensembleMs = Date.now() - t1;
  // 3. one full (standard-length) fit
  await page.locator('#rail button[data-target="fit"]').click();
  await page.selectOption('#fit-sample', 'synthetic-seir-weekly');
  await page.selectOption('#fit-length', 'standard');
  const t2 = Date.now();
  await page.locator('#fit-run').click();
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 200_000 });
  const fitMs = Date.now() - t2;
  const long = await longTasks();
  const worst = Math.max(0, ...long);
  console.log(
    `PERF slider update avg ${sliderMs.toFixed(1)} ms/keypress (incl. Playwright round trip); ensemble 1000 x N=1e6: ${(ensembleMs / 1000).toFixed(2)} s; full fit: ${(fitMs / 1000).toFixed(2)} s; long tasks >50ms: ${long.length}, worst ${worst.toFixed(0)} ms`,
  );
  expect(worst).toBeLessThan(400);
  await app.close();
});

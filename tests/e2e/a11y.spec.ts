import { expect, test } from '@playwright/test';
import { launchApp, ready } from './helpers';

test.describe('keyboard and accessibility', () => {
  test('sliders, tabs, buttons and the Space shortcut work from the keyboard', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const before = Number(await page.locator('#f-r0').inputValue());
    await page.locator('#f-r0-slider').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => Number(await page.locator('#f-r0').inputValue()))
      .toBeCloseTo(before + 0.2, 5);
    await page.locator('#tab-compartments').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-incidence')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#btn-add-contact').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.event')).toHaveCount(1);
    const start = page.locator('.event input').first();
    await start.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('50');
    await page.keyboard.press('Tab');
    await expect(page.locator('.event input').first()).toHaveValue('50');
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('Space');
    await expect(page.locator('#tab-stochastic')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#ens-state')).toContainText(/Finished|Running/, { timeout: 60_000 });
    await app.close();
  });

  test('every control has an accessible name; charts have labels and text-table fallbacks; focus rings are visible', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const check = async (): Promise<string[]> =>
      page.evaluate(() => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'input, select, button, textarea, canvas',
        )) {
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue; // hidden controls
          const name =
            el.getAttribute('aria-label') ??
            (el as HTMLInputElement).labels?.[0]?.textContent ??
            el.textContent ??
            '';
          if (name.trim() === '') bad.push(`${el.tagName}#${el.id}`);
        }
        return bad;
      });
    expect(await check()).toEqual([]);
    await page.locator('#rail button[data-target="fit"]').click();
    await page.selectOption('#fit-sample', 'synthetic-seir-weekly');
    expect(await check()).toEqual([]);
    await page.locator('#rail button[data-target="simulator"]').click();
    for (const id of ['chart-main', 'chart-inc', 'chart-reff', 'chart-ens', 'chart-cmp'])
      expect(await page.locator(`#${id}`).getAttribute('aria-label')).toBeTruthy();
    for (const id of ['table-main', 'table-inc', 'table-reff'])
      await expect(page.locator(`#${id} details`)).toHaveCount(1);
    await page.locator('#btn-undo').focus();
    await page.locator('#btn-theme').focus();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  test('prefers-reduced-motion turns transitions off', async () => {
    const app = await launchApp();
    const page = await ready(app);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const d = await page.evaluate(
      () => getComputedStyle(document.querySelector('.btn') as Element).transitionDuration,
    );
    expect(parseFloat(d)).toBe(0);
    await app.close();
  });
});

import { expect, test } from '@playwright/test';
import { launchApp } from './helpers';

test('shell launches, is locked down, and a worker runs under the CSP', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await expect(page).toHaveTitle('OutbreakScope');
  await expect(page.locator('#check-worker')).toHaveAttribute('data-ok', 'true');
  await expect(page.locator('#check-no-node')).toHaveAttribute('data-ok', 'true');
  await expect(page.locator('#check-api')).toHaveAttribute('data-ok', 'true');
  expect(page.url().startsWith('app://local/')).toBe(true);
  expect(errors).toEqual([]);

  await app.close();
});

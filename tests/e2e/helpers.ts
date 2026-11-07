import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Creates a throwaway profile directory. */
export function tempDir(prefix = 'outbreakscope-e2e-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Launches the built app with the given profile and a hidden window (no focus stealing on the user's Mac). */
export async function launchApp(userData: string = tempDir()): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: { ...process.env, OUTBREAKSCOPE_HIDDEN: '1', OUTBREAKSCOPE_USER_DATA: userData },
  });
}

/** Sets a numeric control (typing then leaving the field commits the change). */
export async function setField(page: Page, key: string, value: number): Promise<void> {
  const input = page.locator(`#f-${key}`);
  await input.fill(String(value));
  await input.blur();
}

/** Text of a key-number card's value. */
export async function stat(page: Page, title: string): Promise<string> {
  return (await page.locator(`[data-stat="${title}"] .stat-value`).first().innerText()).trim();
}

/** Makes the next native save/open dialog return a fixed path (so tests can use the real IPC path without a human). */
export async function stubDialogs(
  app: ElectronApplication,
  opts: { save?: string; open?: string },
): Promise<void> {
  await app.evaluate(({ dialog }, o) => {
    dialog.showSaveDialog = () =>
      Promise.resolve({
        canceled: o.save === undefined,
        filePath: o.save ?? '',
      });
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: o.open === undefined,
        filePaths: o.open === undefined ? [] : [o.open],
      });
  }, opts);
}

/** Sends a native-menu action to the page (same path the real menu uses). */
export async function menu(page: Page, action: string): Promise<void> {
  await page.evaluate(
    (a) => window.dispatchEvent(new CustomEvent('outbreakscope:menu', { detail: a })),
    action,
  );
}

/** First window, waiting until the renderer has fully started (its self-checks finished). */
export async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.locator('#check-worker').waitFor({ state: 'attached' });
  return page;
}

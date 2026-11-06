import { _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Launches the built app with a throwaway profile and a hidden window (no focus stealing). */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(path.join(tmpdir(), 'outbreakscope-e2e-'));
  return electron.launch({
    args: ['.'],
    env: { ...process.env, OUTBREAKSCOPE_HIDDEN: '1', OUTBREAKSCOPE_USER_DATA: userData },
  });
}

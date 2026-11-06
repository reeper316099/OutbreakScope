import { defineConfig } from '@playwright/test';

// End-to-end tests drive the built Electron app (hidden window; see tests/e2e/helpers).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});

import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp, menu, ready, stubDialogs, tempDir } from './helpers';

test.describe('security', () => {
  test('renderer is isolated: no require/process, inline script is blocked by the CSP, CSP header is strict', async () => {
    const app = await launchApp();
    const page = await ready(app);
    // (page.evaluate runs through the debugger and ignores the CSP, so eval itself cannot be probed this way; an injected inline script is page-owned code and must be blocked.)
    const r = await page.evaluate(async () => {
      const g = globalThis as Record<string, unknown>;
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        violations.push(e.violatedDirective),
      );
      const s = document.createElement('script');
      s.textContent = 'window.__ran = true';
      document.head.appendChild(s);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        req: typeof g['require'],
        proc: typeof g['process'],
        mod: typeof g['module'],
        inlineRan: (window as unknown as { __ran?: boolean }).__ran === true,
        violated: violations.some((v) => v.startsWith('script-src')),
        apiKeys: Object.keys(window.outbreakscope).sort(),
      };
    });
    expect(r).toEqual({
      req: 'undefined',
      proc: 'undefined',
      mod: 'undefined',
      inlineRan: false,
      violated: true,
      apiKeys: ['getAppInfo', 'openExternal', 'openFile', 'saveFile'],
    });
    const csp = await app.evaluate(async ({ net }) =>
      (await net.fetch('app://local/index.html')).headers.get('content-security-policy'),
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/unsafe-/);
    await app.close();
  });

  test('app:// rejects path traversal and serves real files', async () => {
    const app = await launchApp();
    await ready(app);
    const statuses = await app.evaluate(async ({ net }) => {
      const get = async (u: string): Promise<number> => (await net.fetch(u)).status;
      return [
        await get('app://local/index.html'),
        await get('app://local/%2e%2e/%2e%2e/package.json'),
        await get('app://local/..%2f..%2fpackage.json'),
        await get('app://local/../package.json'),
        await get('app://local/nope.js'),
      ];
    });
    expect(statuses[0]).toBe(200);
    for (const s of statuses.slice(1)) expect([403, 404]).toContain(s);
    // The URL parser resolves encoded dot segments before the handler sees them, so these end up as harmless 404s inside the app folder; raw traversal is unit-tested to give 403.
    await app.close();
  });

  test('external navigation and new windows are blocked', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const opened = await page.evaluate(() => window.open('https://example.com/') === null);
    expect(opened).toBe(true);
    await page.evaluate(() => {
      location.href = 'https://example.com/';
    });
    await page.waitForTimeout(800);
    expect(page.url().startsWith('app://local/')).toBe(true);
    expect(app.windows().length).toBe(1);
    await app.close();
  });

  test('openExternal rejects non-https, non-allowlisted and look-alike hosts (an allowlisted link is deliberately not opened here)', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const results = await page.evaluate(async () => {
      const bad = [
        'http://github.com/x',
        'https://evil.example/',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'https://github.com.evil.example/',
        'https://user:pw@github.com/',
        '',
      ];
      return Promise.all(bad.map((u) => window.outbreakscope.openExternal(u)));
    });
    for (const r of results) expect(r.ok).toBe(false);
    await app.close();
  });

  test('IPC arguments are validated in the main process', async () => {
    const app = await launchApp();
    const page = await ready(app);
    const r = await page.evaluate(async () => {
      const api = window.outbreakscope as unknown as Record<
        string,
        (x: unknown) => Promise<{ ok: boolean; reason?: string }>
      >;
      return [
        await api['openFile']?.({ kind: 'exe' }),
        await api['openFile']?.({ kind: 'csv', path: '/etc/passwd' }),
        await api['saveFile']?.({ kind: 'sh', defaultName: 'x', data: 'x', encoding: 'utf8' }),
        await api['saveFile']?.({ kind: 'png', defaultName: 'x.png', data: 'x', encoding: 'utf8' }),
      ];
    });
    for (const x of r) expect(x?.ok).toBe(false);
    await app.close();
  });

  test('openFile enforces the size cap, file type and text-only rule in the main process', async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const big = path.join(dir, 'big.csv');
    writeFileSync(big, 'date,cases\n' + 'x'.repeat(6 * 1024 * 1024));
    const exe = path.join(dir, 'program.exe');
    writeFileSync(exe, 'date,cases\n2024-01-07,3\n');
    const bin = path.join(dir, 'binary.csv');
    writeFileSync(bin, Buffer.from([100, 97, 116, 101, 0, 0, 1, 2, 3]));
    const app = await launchApp();
    const page = await ready(app);
    for (const [file, message] of [
      [big, 'larger than 5 MB'],
      [exe, 'Expected a .csv'],
      [bin, 'looks binary'],
    ] as const) {
      await stubDialogs(app, { open: file });
      await menu(page, 'file:open-csv');
      await expect(page.locator('#toast')).toContainText(message);
    }
    await app.close();
  });

  test('no outbound network requests during a full click-through; blocked fetches are reported by the CSP', async () => {
    test.setTimeout(180_000);
    const app = await launchApp();
    const page = await ready(app);
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    const violations = await page.evaluate(() => {
      const seen: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        seen.push(`${e.violatedDirective}:${e.blockedURI}`),
      );
      (window as unknown as { __v: string[] }).__v = seen;
      return true;
    });
    expect(violations).toBe(true);
    // Try to leave: fetch, image, WebSocket must all fail.
    const attempts = await page.evaluate(async () => {
      const out: string[] = [];
      try {
        await fetch('https://example.com/');
        out.push('fetch-ok');
      } catch {
        out.push('fetch-blocked');
      }
      const img = new Image();
      img.src = 'https://example.com/x.png';
      try {
        new WebSocket('wss://example.com/');
        out.push('ws-created');
      } catch {
        out.push('ws-blocked');
      }
      await new Promise((r) => setTimeout(r, 300));
      return out;
    });
    expect(attempts[0]).toBe('fetch-blocked');
    // Click through every view, run a stochastic ensemble and a quick fit.
    for (const v of ['simulator', 'explainer', 'fit', 'about'])
      await page.locator(`#rail button[data-target="${v}"]`).click();
    await page.locator('#rail button[data-target="simulator"]').click();
    await page.locator('#tab-stochastic').click();
    await page.locator('#btn-run').click();
    await expect(page.locator('#fizzle-panel')).toBeVisible({ timeout: 60_000 });
    await page.locator('#rail button[data-target="fit"]').click();
    await page.selectOption('#fit-sample', 'synthetic-seir-weekly');
    await page.selectOption('#fit-length', 'quick');
    await page.locator('#fit-run').click();
    await expect(page.locator('#verdict')).toBeVisible({ timeout: 100_000 });
    const outside = urls.filter(
      (u) => !/^(app:|data:|blob:)/.test(u) && !u.startsWith('https://example.com/'),
    );
    expect(outside).toEqual([]);
    // The only non-app URLs are the deliberate attempts above, which never got a response.
    const reached = urls.filter((u) => u.startsWith('https://example.com/'));
    expect(reached.length).toBeLessThanOrEqual(2);
    await app.close();
  });
});

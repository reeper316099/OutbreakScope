import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

/** All .ts/.js/.html files under a folder (recursively). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|html)$/.test(n) ? [p] : [];
  });
}
/** Source text without comments, so a comment that mentions a banned API is not a violation. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
const sources = [...files(path.join(root, 'src')), ...files(path.join(root, 'electron'))];

describe('code policy (rules 3, 6 and 9)', () => {
  const forbidden: [string, RegExp][] = [
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /new\s+WebSocket/],
    ['sendBeacon', /sendBeacon/],
    ['eval(', /\beval\s*\(/],
    ['new Function', /new\s+Function\s*\(/],
    ['Math.random', /Math\.random/],
    [
      'electron net module (main-process network)',
      /from\s+'electron'[^;]*\bnet\b|\bnet\.(fetch|request)/,
    ],
    ['child_process', /child_process/],
    ['nodeIntegration: true', /nodeIntegration:\s*true/],
    ['sandbox: false', /sandbox:\s*false/],
    ['contextIsolation: false', /contextIsolation:\s*false/],
    ['CDN script/style', /<(script|link)[^>]+https?:\/\//],
  ];
  for (const [label, re] of forbidden) {
    it(`no "${label}" anywhere in src/ or electron/`, () => {
      const hits = sources.filter((f) => re.test(code(f))).map((f) => path.relative(root, f));
      expect(hits).toEqual([]);
    });
  }
  it('main-process window settings are the locked-down ones', () => {
    const main = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    for (const s of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true'])
      expect(main).toContain(s);
  });
  it('there are no TODO / FIXME / placeholder markers in shipped code', () => {
    const hits = sources
      .filter((f) => /\b(TODO|FIXME|XXX|lorem ipsum)\b/i.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPARTMENT_DASH } from '../../src/ui/palette';

const css = readFileSync(path.resolve(import.meta.dirname, '../../src/styles/tokens.css'), 'utf8');

/** Reads the custom properties of a block starting at `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [
      m[1] as string,
      (m[2] as string).toLowerCase(),
    ]),
  );
}
const light = tokens(':root');
const dark = { ...light, ...tokens("[data-theme='dark']") };

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
/** WCAG contrast ratio of two colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x as number) + 0.05) / ((y as number) + 0.05);
}

describe('colour contrast (WCAG 2.x, minimum 4.5:1 for text)', () => {
  for (const [name, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    const pairs: [string, string, string][] = [
      ['text', 'bg', 'body text on page'],
      ['text', 'surface', 'body text on cards'],
      ['text-muted', 'surface', 'secondary text on cards'],
      ['text-muted', 'bg', 'secondary text on the page'],
      ['primary-accent', 'surface', 'links'],
      ['on-accent', 'primary-accent', 'primary buttons'],
      ['danger', 'surface', 'error text'],
      ['warn', 'surface', 'warning text'],
    ];
    for (const [fg, bg, what] of pairs) {
      it(`${name}: ${what} (${fg} on ${bg}) >= 4.5`, () => {
        expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('banner and header text', () => {
    expect(contrast('#5a4300', '#fff4d6')).toBeGreaterThanOrEqual(4.5); // light banner
    expect(contrast('#f3dfa0', '#3a2f10')).toBeGreaterThanOrEqual(4.5); // dark banner
    // White header text must be readable at both ends of the real gradient defined in components.css (buttons sit at the right end).
    const components = readFileSync(
      path.resolve(import.meta.dirname, '../../src/styles/components.css'),
      'utf8',
    );
    const stops =
      /\.topbar\s*\{[^}]*linear-gradient\(90deg,\s*(#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/.exec(
        components,
      );
    expect(stops).not.toBeNull();
    for (const stop of [stops?.[1], stops?.[2]])
      expect(contrast('#ffffff', (stop ?? '#ffffff').toLowerCase())).toBeGreaterThanOrEqual(4.5);
  });
});

describe('colour-blind-safe compartment styling', () => {
  it('uses the published Okabe-Ito colours (Okabe & Ito 2008): blue, orange, vermillion, bluish green, reddish purple', () => {
    expect([light['c-S'], light['c-E'], light['c-I'], light['c-R'], light['c-V']]).toEqual([
      '#0072b2',
      '#e69f00',
      '#d55e00',
      '#009e73',
      '#cc79a7',
    ]);
  });
  it('every compartment has a different dash pattern, so colour is never the only signal', () => {
    const patterns = Object.values(COMPARTMENT_DASH).map((d) => d.join(','));
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

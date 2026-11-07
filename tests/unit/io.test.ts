import { describe, expect, it } from 'vitest';
import { loadPreferences, savePreferences } from '../../src/io/storage';
import { csvHeader, deterministicCsv } from '../../src/io/export';
import { parseScenarioFile, serializeScenario } from '../../src/io/session';
import type { Scenario } from '../../src/shared/types';
import { runScenario } from '../../src/sim/scenario';
import { params } from './helpers';

const scenario: Scenario = {
  params: params({ horizonDays: 30 }),
  interventions: [{ type: 'contact_reduction', startDay: 10, endDay: 20, strength: 0.4 }],
  seed: 12345,
  ensembleSize: 50,
};

describe('scenario files', () => {
  it('round-trips a scenario exactly', () => {
    const text = serializeScenario(scenario, '0.1.0', new Date('2026-01-02T03:04:05Z'));
    const back = parseScenarioFile(text);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.scenario).toEqual(scenario);
      expect(back.appVersion).toBe('0.1.0');
    }
    expect((JSON.parse(text) as { savedAt: string }).savedAt).toBe('2026-01-02T03:04:05.000Z');
  });
  it('gives friendly errors for corrupted, wrong, newer and invalid files', () => {
    const msg = (t: string): string => {
      const r = parseScenarioFile(t);
      return r.ok ? 'OK' : r.message;
    };
    expect(msg('{not json')).toMatch(/not valid JSON/);
    expect(msg('[1,2,3]')).toMatch(/does not look like/);
    expect(msg('{"app":"Other"}')).toMatch(/does not look like/);
    const good = JSON.parse(serializeScenario(scenario, '0.1.0')) as Record<string, unknown>;
    expect(msg(JSON.stringify({ ...good, formatVersion: 2 }))).toMatch(/newer version/);
    expect(msg(JSON.stringify({ ...good, formatVersion: 0 }))).toMatch(/Unsupported/);
    const bad = { ...good, scenario: { ...scenario, params: { ...scenario.params, r0: -3 } } };
    expect(msg(JSON.stringify(bad))).toMatch(/invalid values/);
    const extraSeed = { ...good, scenario: { ...scenario, seed: -1 } };
    expect(msg(JSON.stringify(extraSeed))).toMatch(/does not look like/);
  });
});

describe('CSV export', () => {
  it('starts with comment rows (model, parameters, seed, app version) and has one data row per day', () => {
    const out = runScenario(scenario);
    if (!out.ok) throw new Error('valid scenario expected');
    const csv = deterministicCsv(out.result, '0.1.0');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('OutbreakScope 0.1.0');
    expect(csvHeader(scenario, '0.1.0').join('\n')).toContain('seed=12345');
    expect(lines.filter((l) => l.startsWith('#')).join('\n')).toContain('model=SEIR');
    const header = lines.findIndex((l) => l.startsWith('day,'));
    expect(lines.slice(header + 1).length).toBe(31);
    expect(lines[header + 1]?.split(',')[0]).toBe('0');
    expect(lines[lines.length - 1]?.split(',').length).toBe(9);
  });
});

describe('typed storage', () => {
  const fake = (initial?: string) => {
    let v = initial;
    return {
      getItem: () => v ?? null,
      setItem: (_k: string, x: string) => {
        v = x;
      },
    };
  };
  it('stores and reads the theme; ignores corrupt data and missing storage', () => {
    const s = fake();
    savePreferences({ theme: 'dark' }, s);
    expect(loadPreferences(s)).toEqual({ theme: 'dark' });
    expect(loadPreferences(fake('{"theme":"purple"}'))).toEqual({});
    expect(loadPreferences(fake('not json'))).toEqual({});
    expect(loadPreferences(undefined)).toEqual({});
    expect(() =>
      savePreferences(
        { theme: 'light' },
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota');
          },
        },
      ),
    ).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/shared/types';
import { ALLOWED_EXTERNAL_HOSTS } from '../../electron/allowlist';
import { PRESETS } from '../../src/sim/presets';
import { describeDifference, runScenario, validateScenario } from '../../src/sim/scenario';
import { userToInternal } from '../../src/sim/params';
import { params } from './helpers';

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  params: params(),
  interventions: [],
  seed: 1,
  ensembleSize: 100,
  ...over,
});

describe('runScenario', () => {
  it('returns key numbers consistent with the derived-quantity formulas', () => {
    const out = runScenario(
      scenario({
        params: params({ r0: 3, incubationDays: 3, infectiousDays: 5, horizonDays: 300 }),
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const n = out.result.numbers;
    expect(n.herdImmunityThreshold).toBeCloseTo(1 - 1 / 3, 15);
    expect(n.analyticFinalSize).toBeCloseTo(0.9404798, 6);
    expect(Math.abs(n.attackRate - n.analyticFinalSize)).toBeLessThan(0.002); // I0 = 10 of 1e6, so very close to the analytic value
    expect(n.reffStart).toBeCloseTo((3 * (1e6 - 10)) / 1e6, 10);
    expect(n.growthWindow?.startDay).toBe(0);
    expect(n.stillOngoing).toBe(false);
    expect(n.peakInfectious).toBeGreaterThan(0);
    expect(n.doublingTimeDays).toBeCloseTo(Math.LN2 / n.growthRate, 12);
  });
  it('reports invalid input as issues, not exceptions', () => {
    const out = runScenario(scenario({ params: params({ r0: NaN, population: 0 }) }));
    expect(out.ok).toBe(false);
    if (!out.ok)
      expect(out.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['r0', 'population']));
    expect(
      validateScenario(
        scenario({
          interventions: [{ type: 'vaccination', startDay: 1, endDay: 5, strength: 0.01 }],
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it('flags an epidemic that is still running at the end of the window', () => {
    const out = runScenario(scenario({ params: params({ r0: 1.5, horizonDays: 40 }) }));
    expect(out.ok && out.result.numbers.stillOngoing).toBe(true);
  });
  it('counts vaccinations and marks R_eff < 1 once enough are immune (perfect vaccine)', () => {
    const out = runScenario(
      scenario({
        params: params({ model: 'SEIRV', vaccineEfficacy: 1, r0: 2, horizonDays: 200 }),
        interventions: [{ type: 'vaccination', startDay: 0, endDay: 100, strength: 0.1 }],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.numbers.totalVaccinated).toBeGreaterThan(1e5);
      expect(out.result.numbers.growthWindow?.endDay).toBeLessThan(30);
    }
  });
});

describe('describeDifference', () => {
  it('words a reduced, delayed peak', () => {
    const a = runScenario(scenario({ params: params({ r0: 3, horizonDays: 300 }) }));
    const b = runScenario(
      scenario({
        params: params({ r0: 3, horizonDays: 300 }),
        interventions: [{ type: 'contact_reduction', startDay: 20, endDay: 300, strength: 0.4 }],
      }),
    );
    if (!a.ok || !b.ok) throw new Error('scenarios should be valid');
    const text = describeDifference(a.result.numbers, b.result.numbers);
    expect(text).toMatch(/peak reduced by \d+%/);
    expect(text).toMatch(/delayed by \d+ days/);
    expect(describeDifference(a.result.numbers, a.result.numbers)).toBe(
      'peak size about the same, peak day about the same',
    );
  });
});

describe('presets', () => {
  it('every preset is internally consistent and convertible to valid parameters', () => {
    for (const pr of PRESETS) {
      for (const v of [pr.r0, pr.incubationDays, pr.infectiousDays]) {
        if (v === null) continue;
        expect(v.low).toBeLessThanOrEqual(v.value);
        expect(v.value).toBeLessThanOrEqual(v.high);
        expect(v.how.length).toBeGreaterThan(10);
      }
      expect(() =>
        userToInternal(
          params({
            model: pr.model,
            r0: pr.r0.value,
            incubationDays: pr.incubationDays?.value ?? 1,
            infectiousDays: pr.infectiousDays.value,
          }),
        ),
      ).not.toThrow();
    }
  });
  it('every non-hypothetical preset has at least one https source on the external-link allowlist; hypothetical ones say they are assumed', () => {
    for (const pr of PRESETS) {
      const assumed = [pr.r0, pr.incubationDays, pr.infectiousDays].every(
        (v) => v === null || v.kind === 'assumed',
      );
      if (assumed) {
        expect(pr.sources.length).toBe(0);
      } else {
        expect(pr.sources.length).toBeGreaterThan(0);
        for (const s of pr.sources)
          expect(
            ALLOWED_EXTERNAL_HOSTS.has(new URL(s.url).hostname) && s.url.startsWith('https://'),
          ).toBe(true);
      }
    }
  });
  it('has unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});

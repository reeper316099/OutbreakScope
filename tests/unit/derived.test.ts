import { describe, expect, it } from 'vitest';
import type { Trajectory } from '../../src/shared/types';
import {
  attackRate,
  doublingTime,
  earlyGrowthRate,
  effectiveR,
  finalSizeFraction,
  halvingTime,
  herdImmunityThreshold,
  incidencePerDay,
  logSlope,
  peakInfectious,
  peakOf,
} from '../../src/sim/derived';
import { ParamError } from '../../src/sim/errors';
import { buildSchedule } from '../../src/sim/interventions';
import { userToInternal } from '../../src/sim/params';
import { uniformGrid } from '../../src/sim/rk4';
import { params, run } from './helpers';

/** Builds a Trajectory from a few arrays (other fields zero) for hand-computed cases. */
function traj(
  times: number[],
  fields: Partial<Record<'S' | 'I' | 'V' | 'cumInfections', number[]>>,
): Trajectory {
  const n = times.length;
  const z = (): Float64Array => new Float64Array(n);
  const f = (a?: number[]): Float64Array => (a ? Float64Array.from(a) : z());
  return {
    times: Float64Array.from(times),
    S: f(fields.S),
    E: z(),
    I: f(fields.I),
    R: z(),
    V: f(fields.V),
    cumInfections: f(fields.cumInfections),
    cumOnsets: z(),
    cumVaccinated: z(),
  };
}

describe('hand-computable derived quantities', () => {
  it('herd immunity threshold 1 - 1/R0', () => {
    expect(herdImmunityThreshold(2)).toBe(0.5);
    expect(herdImmunityThreshold(4)).toBe(0.75);
    expect(herdImmunityThreshold(1)).toBe(0);
    expect(herdImmunityThreshold(0.5)).toBe(0);
    expect(() => herdImmunityThreshold(NaN)).toThrow(ParamError);
    expect(() => herdImmunityThreshold(-1)).toThrow(ParamError);
  });
  it('final size root of z = 1 - exp(-R0 z): R0=2 gives 0.7968121300 (known value), residual ~ 0', () => {
    expect(finalSizeFraction(2)).toBeCloseTo(0.79681213, 8);
    for (const r0 of [1.0001, 1.2, 2, 3, 10, 50]) {
      const z = finalSizeFraction(r0);
      expect(Math.abs(z - (1 - Math.exp(-r0 * z)))).toBeLessThan(1e-13);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThanOrEqual(1); // equals 1 to double precision for very large R0
    }
    expect(finalSizeFraction(1.001)).toBeCloseTo(2 * 0.001, 3); // near R0 = 1 the root is about 2(R0 - 1)
  });
  it('no outbreak root for R0 <= 1', () => {
    expect(finalSizeFraction(1)).toBe(0);
    expect(finalSizeFraction(0.3)).toBe(0);
    expect(finalSizeFraction(0)).toBe(0);
  });
  it('early growth rate: SIR beta - gamma; SEIR closed form with exactly solvable cases', () => {
    expect(
      earlyGrowthRate('SIR', { betaPerDay: 0.4, gammaPerDay: 0.2, sigmaPerDay: null }),
    ).toBeCloseTo(0.2, 15);
    // sigma = gamma = 1, beta = 4: r = (-2 + sqrt(0 + 16)) / 2 = 1 exactly.
    expect(earlyGrowthRate('SEIR', { betaPerDay: 4, gammaPerDay: 1, sigmaPerDay: 1 })).toBeCloseTo(
      1,
      14,
    );
    // sigma = gamma = 0.25, beta = 0.5: r = (-0.5 + sqrt(0.5)) / 2.
    expect(
      earlyGrowthRate('SEIR', { betaPerDay: 0.5, gammaPerDay: 0.25, sigmaPerDay: 0.25 }),
    ).toBeCloseTo((-0.5 + Math.SQRT1_2) / 2, 14);
    // R0 = 1 (beta = gamma) gives r = 0 for any sigma.
    expect(
      earlyGrowthRate('SEIR', { betaPerDay: 0.3, gammaPerDay: 0.3, sigmaPerDay: 0.7 }),
    ).toBeCloseTo(0, 14);
    // sigma -> infinity recovers the SIR value.
    expect(
      earlyGrowthRate('SEIR', { betaPerDay: 0.6, gammaPerDay: 0.2, sigmaPerDay: 1e8 }),
    ).toBeCloseTo(0.4, 6);
  });
  it('doubling and halving times', () => {
    expect(doublingTime(0.2)).toBeCloseTo(Math.LN2 / 0.2, 15);
    expect(doublingTime(0)).toBeNull();
    expect(doublingTime(-0.1)).toBeNull();
    expect(halvingTime(-0.1)).toBeCloseTo(Math.LN2 / 0.1, 15);
    expect(halvingTime(0.1)).toBeNull();
  });
  it('peak refinement: exact parabola 10 - (t - 3.3)^2 sampled at integers peaks at day 3.3, value 10', () => {
    const t = [0, 1, 2, 3, 4, 5, 6];
    const peak = peakOf(Float64Array.from(t), Float64Array.from(t.map((x) => 10 - (x - 3.3) ** 2)));
    expect(peak.day).toBeCloseTo(3.3, 12);
    expect(peak.value).toBeCloseTo(10, 12);
  });
  it('peak at the edge or on a flat curve falls back to the grid maximum', () => {
    expect(peakOf(Float64Array.of(0, 1, 2), Float64Array.of(5, 4, 3))).toEqual({
      day: 0,
      value: 5,
    });
    expect(peakOf(Float64Array.of(0, 1, 2), Float64Array.of(2, 2, 2))).toEqual({
      day: 0,
      value: 2,
    });
    expect(peakInfectious(traj([0, 1, 2], { I: [1, 9, 4] })).value).toBeGreaterThanOrEqual(9);
  });
  it('R_eff = R0 * c * (S + (1-e) V) / N on hand-computed points', () => {
    const sched = buildSchedule(
      [{ type: 'contact_reduction', startDay: 10, endDay: 20, strength: 0.5 }],
      30,
    );
    const t = traj([0, 15, 25], { S: [1000, 800, 600], V: [0, 0, 0] });
    const r = effectiveR(t, 3, 1000, 0, sched);
    [3, 3 * 0.5 * 0.8, 3 * 0.6].forEach((x, i) => expect(r[i]).toBeCloseTo(x, 14));
    const withVax = effectiveR(
      traj([0], { S: [600], V: [200] }),
      3,
      1000,
      0.5,
      buildSchedule([], 30),
    );
    expect(withVax[0]).toBeCloseTo((3 * (600 + 0.5 * 200)) / 1000, 15); // 2.1
  });
  it('incidence per day = differences of cumulative infections / interval; attack rate = last cumulative / N', () => {
    const t = traj([0, 1, 3], { cumInfections: [0, 10, 50] });
    expect(Array.from(incidencePerDay(t))).toEqual([10, 20]);
    expect(attackRate(t, 100)).toBe(0.5);
  });
  it('logSlope recovers the rate of an exact exponential and rejects too-few points', () => {
    const t = uniformGrid(10);
    const v = Float64Array.from(t, (x) => 3 * Math.exp(0.37 * x));
    expect(logSlope(t, v, 0, 10)).toBeCloseTo(0.37, 12);
    expect(() => logSlope(t, v, 100, 200)).toThrow(ParamError);
  });
});

describe('analytical checks against the simulation', () => {
  it('SIR final size (N = 1e8, I0 = 1) matches the root of z = 1 - exp(-R0 z), tolerance 1e-6', () => {
    for (const r0 of [1.5, 2, 3, 5]) {
      const p = params({
        model: 'SIR',
        r0,
        infectiousDays: 5,
        population: 1e8,
        initialInfected: 1,
        horizonDays: 1500,
      });
      const { trajectory: t } = run(p);
      expect(Math.abs(attackRate(t, p.population) - finalSizeFraction(r0))).toBeLessThan(1e-6);
    }
  });
  it('SEIR final size also matches (the exposed stage only delays infection)', () => {
    const p = params({ r0: 2.5, population: 1e8, initialInfected: 1, horizonDays: 1500 });
    expect(
      Math.abs(attackRate(run(p).trajectory, p.population) - finalSizeFraction(2.5)),
    ).toBeLessThan(1e-6);
  });
  it('early SEIR growth rate (log-slope of I over days 25-35, N = 1e10) matches the eigenvalue formula within 1e-4 relative', () => {
    for (const r0 of [1.5, 3, 6]) {
      const p = params({
        r0,
        incubationDays: 3,
        infectiousDays: 5,
        population: 1e10,
        initialInfected: 1,
        horizonDays: 60,
      });
      const { trajectory: t } = run(p);
      const r = earlyGrowthRate('SEIR', userToInternal(p));
      expect(Math.abs(logSlope(t.times, t.I, 25, 35) - r) / r).toBeLessThan(1e-4);
    }
  });
  it('early SIR growth rate matches beta - gamma', () => {
    const p = params({
      model: 'SIR',
      r0: 3,
      infectiousDays: 5,
      population: 1e10,
      initialInfected: 1,
      horizonDays: 40,
    });
    const { trajectory: t } = run(p);
    expect(Math.abs(logSlope(t.times, t.I, 0, 15) - 0.4)).toBeLessThan(1e-6);
  });
  it('herd immunity: at the peak of E+I (= I for SIR), S/N = 1/R0 and R_eff = 1 (no interventions), tolerance 3e-3', () => {
    for (const model of ['SIR', 'SEIR'] as const) {
      for (const r0 of [1.8, 3, 5]) {
        const p = params({ model, r0, population: 1e6, initialInfected: 10, horizonDays: 400 });
        const { trajectory: t } = run(p, [], { outputTimes: uniformGrid(400, 0.01) });
        const reff = effectiveR(t, r0, p.population, 0, buildSchedule([], 400));
        // d(E+I)/dt = gamma I (R_eff - 1), so it is E+I (not I alone, in SEIR) that peaks exactly where R_eff = 1.
        const prevalence = Array.from(t.I, (x, i) => x + (t.E[i] as number));
        const k = prevalence.indexOf(Math.max(...prevalence));
        expect(Math.abs((t.S[k] as number) / p.population - 1 / r0)).toBeLessThan(1e-3);
        expect(Math.abs((reff[k] as number) - 1)).toBeLessThan(3e-3);
        // R_eff > 1 before the peak and < 1 after it.
        expect(reff[Math.max(0, k - 400)] as number).toBeGreaterThan(1);
        expect(reff[Math.min(reff.length - 1, k + 400)] as number).toBeLessThan(1);
      }
    }
  });
  it('a contact reduction starting before the peak lowers the peak and delays it', () => {
    const p = params({ r0: 3, horizonDays: 300 });
    const base = peakInfectious(run(p).trajectory);
    const cut = peakInfectious(
      run(p, [{ type: 'contact_reduction', startDay: 20, endDay: 300, strength: 0.4 }]).trajectory,
    );
    expect(cut.value).toBeLessThan(base.value);
    expect(cut.day).toBeGreaterThan(base.day);
  });
});

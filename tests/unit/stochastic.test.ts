import { describe, expect, it } from 'vitest';
import type { Intervention, UserParams } from '../../src/shared/types';
import { finalSizeFraction } from '../../src/sim/derived';
import { ParamError } from '../../src/sim/errors';
import { buildSchedule } from '../../src/sim/interventions';
import { userToInternal } from '../../src/sim/params';
import {
  ensembleBands,
  MAJOR_OUTBREAK_FRACTION,
  quantileSorted,
  runEnsemble,
  runRealization,
} from '../../src/sim/stochastic';
import type { StochasticMethod, StochasticOptions, StochasticRun } from '../../src/sim/stochastic';
import { params, run } from './helpers';

function sopts(
  p: UserParams,
  seed: number,
  method: StochasticMethod,
  iv: Intervention[] = [],
  extra: Partial<StochasticOptions> = {},
): StochasticOptions {
  return {
    model: p.model,
    rates: userToInternal(p),
    population: p.population,
    initialInfected: p.initialInfected,
    vaccineEfficacy: p.vaccineEfficacy,
    schedule: buildSchedule(iv, p.horizonDays),
    horizonDays: p.horizonDays,
    seed,
    method,
    ...extra,
  };
}
const same = (a: StochasticRun, b: StochasticRun): boolean =>
  ['S', 'E', 'I', 'R', 'V', 'cumInfections'].every((k) =>
    (a as never as Record<string, Float64Array>)[k]?.every(
      (v, i) => v === (b as never as Record<string, Float64Array>)[k]?.[i],
    ),
  );

const methods: StochasticMethod[] = ['gillespie', 'chain_binomial'];

describe('reproducibility', () => {
  for (const method of methods) {
    const p = params({ population: 5000, initialInfected: 5, horizonDays: 120 });
    it(`${method}: same seed -> identical results; different seed -> different results`, () => {
      const a = runRealization(sopts(p, 42, method), 0),
        b = runRealization(sopts(p, 42, method), 0),
        c = runRealization(sopts(p, 43, method), 0);
      expect(same(a, b)).toBe(true);
      expect(same(a, c)).toBe(false);
      expect(
        same(runRealization(sopts(p, 42, method), 0), runRealization(sopts(p, 42, method), 1)),
      ).toBe(false); // other stream
    });
    it(`${method}: results do not depend on how realizations are split across workers`, () => {
      const o = sopts(p, 7, method);
      const whole = runEnsemble(o, 0, 12);
      const split = [
        ...runEnsemble(o, 6, 6),
        ...runEnsemble(o, 0, 3),
        ...runEnsemble(o, 3, 3),
      ].sort((x, y) => x.index - y.index);
      expect(split.length).toBe(12);
      split.forEach((r, i) => expect(same(r, whole[i] as StochasticRun)).toBe(true));
    });
  }
});

describe('invariants', () => {
  const cases: { name: string; p: UserParams; iv: Intervention[]; method: StochasticMethod }[] = [
    {
      name: 'SIR',
      p: params({
        model: 'SIR',
        population: 3000,
        initialInfected: 3,
        r0: 2.5,
        infectiousDays: 6,
        horizonDays: 150,
      }),
      iv: [],
      method: 'gillespie',
    },
    {
      name: 'SEIR + contact reduction',
      p: params({ population: 3000, initialInfected: 3, horizonDays: 150 }),
      iv: [{ type: 'contact_reduction', startDay: 30, endDay: 90, strength: 0.5 }],
      method: 'gillespie',
    },
    {
      name: 'SEIRV',
      p: params({
        model: 'SEIRV',
        vaccineEfficacy: 0.7,
        population: 3000,
        initialInfected: 3,
        r0: 3,
        horizonDays: 150,
      }),
      iv: [{ type: 'vaccination', startDay: 10, endDay: 80, strength: 0.03 }],
      method: 'gillespie',
    },
    {
      name: 'SIR large N',
      p: params({
        model: 'SIR',
        population: 2_000_000,
        initialInfected: 20,
        r0: 2.5,
        infectiousDays: 6,
        horizonDays: 150,
      }),
      iv: [],
      method: 'chain_binomial',
    },
    {
      name: 'SEIRV large N',
      p: params({
        model: 'SEIRV',
        vaccineEfficacy: 0.7,
        population: 2_000_000,
        initialInfected: 20,
        r0: 3,
        horizonDays: 150,
      }),
      iv: [{ type: 'vaccination', startDay: 10, endDay: 80, strength: 0.03 }],
      method: 'chain_binomial',
    },
    {
      name: 'SEIR small N via chain-binomial',
      p: params({ population: 200, initialInfected: 2, horizonDays: 100 }),
      iv: [],
      method: 'chain_binomial',
    },
  ];
  for (const { name, p, iv, method } of cases) {
    it(`${name} (${method}): population conserved, counts are non-negative integers, cumulative infections non-decreasing`, () => {
      for (const r of runEnsemble(sopts(p, 99, method, iv), 0, 5)) {
        for (let i = 0; i < r.times.length; i++) {
          const parts = [r.S[i], r.E[i], r.I[i], r.R[i], r.V[i]] as number[];
          expect(parts.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(p.population);
          if (i > 0)
            expect(r.cumInfections[i] as number).toBeGreaterThanOrEqual(
              r.cumInfections[i - 1] as number,
            );
        }
        if (p.model === 'SIR') expect(r.E.every((x) => x === 0)).toBe(true);
        if (p.model !== 'SEIRV') expect(r.V.every((x) => x === 0)).toBe(true);
      }
    });
  }
  it('auto method picks Gillespie for small N and chain-binomial for large N', () => {
    expect(
      runRealization(
        sopts(params({ population: 1000, horizonDays: 10 }), 1, 'gillespie', [], {
          method: 'auto',
        }),
        0,
      ).method,
    ).toBe('gillespie');
    expect(
      runRealization(
        sopts(params({ population: 100000, horizonDays: 10 }), 1, 'gillespie', [], {
          method: 'auto',
        }),
        0,
      ).method,
    ).toBe('chain_binomial');
  });
  it('rejects non-integer populations, zero or fractional initial infected', () => {
    expect(() => runRealization(sopts(params({ population: 100.5 }), 1, 'gillespie'), 0)).toThrow(
      ParamError,
    );
    expect(() => runRealization(sopts(params({ initialInfected: 0 }), 1, 'gillespie'), 0)).toThrow(
      ParamError,
    );
    expect(() =>
      runRealization(sopts(params({ initialInfected: 2.5 }), 1, 'gillespie'), 0),
    ).toThrow(ParamError);
    expect(() => runRealization(sopts(params(), -1, 'gillespie'), 0)).toThrow(ParamError);
  });
  it('R0 < 1 outbreaks die out and are never "major"', () => {
    const p = params({ r0: 0.5, population: 10000, initialInfected: 3, horizonDays: 200 });
    for (const method of methods) {
      const runs = runEnsemble(sopts(p, 5, method), 0, 40);
      expect(runs.every((r) => !r.major && r.extinct)).toBe(true);
    }
  });
});

describe('agreement with the deterministic model (large I0, so early randomness is small)', () => {
  // Tolerances (stated): mean final size within 1.5% of deterministic; mean I at three times within 6% of the deterministic peak value.
  for (const [method, N, I0, nRuns] of [
    ['gillespie', 20000, 200, 150],
    ['chain_binomial', 500000, 5000, 120],
  ] as const) {
    it(`${method}: mean of ${nRuns} realizations tracks the ODE solution (N = ${N})`, () => {
      const p = params({
        r0: 2.2,
        population: N,
        initialInfected: I0,
        incubationDays: 4,
        infectiousDays: 6,
        horizonDays: 160,
      });
      const det = run(p).trajectory;
      const stoch = ensembleBands(runEnsemble(sopts(p, 2025, method), 0, nRuns), 'I');
      const peak = Math.max(...det.I);
      for (const day of [20, 35, 50])
        expect(Math.abs((stoch.mean[day] as number) - (det.I[day] as number))).toBeLessThan(
          0.06 * peak,
        );
      const cum = ensembleBands(runEnsemble(sopts(p, 2025, method), 0, nRuns), 'cumInfections');
      const detFinal = det.cumInfections[det.times.length - 1] as number;
      expect(
        Math.abs((cum.mean[cum.mean.length - 1] as number) - detFinal) / detFinal,
      ).toBeLessThan(0.015);
      expect(
        Math.abs((cum.mean[cum.mean.length - 1] as number) / N - finalSizeFraction(2.2)),
      ).toBeLessThan(0.02); // and near the analytic final size
    });
  }
});

describe('probability of a major outbreak = 1 - (1/R0)^k  (branching-process prediction)', () => {
  // "Major" = secondary infections >= 5% of N. 1500 realizations -> standard error <= 0.013; tolerance 0.05 (about 4 SE).
  const R0 = 2;
  for (const [method, model, N, k, n] of [
    ['gillespie', 'SIR', 20000, 1, 1500],
    ['gillespie', 'SIR', 20000, 2, 1500],
    ['gillespie', 'SEIR', 20000, 1, 1500],
    ['chain_binomial', 'SIR', 200000, 1, 1500],
  ] as const) {
    it(`${method} ${model}, N = ${N}, k = ${k}: fraction that fizzle ~ ${(1 / R0) ** k}`, () => {
      const p = params({
        model,
        r0: R0,
        infectiousDays: 5,
        incubationDays: 4,
        population: N,
        initialInfected: k,
        horizonDays: 250,
      });
      const runs = runEnsemble(sopts(p, 777, method, [], { dt: 0.05 }), 0, n);
      const fizzled = runs.filter((r) => !r.major).length / n;
      const expected = (1 / R0) ** k;
      expect(Math.abs(fizzled - expected)).toBeLessThan(0.05);
      if (process.env['SHOW_ERRORS'] === '1')
        console.log(method, model, 'k=', k, 'fizzled', fizzled, 'expected', expected);
      // Fizzled runs really are small: well under the major-outbreak threshold.
      expect(
        runs
          .filter((r) => !r.major)
          .every(
            (r) =>
              (r.cumInfections[r.times.length - 1] as number) - k < MAJOR_OUTBREAK_FRACTION * N,
          ),
      ).toBe(true);
    });
  }
});

describe('ensemble helpers', () => {
  it('quantiles of a sorted array interpolate linearly', () => {
    const a = Float64Array.of(1, 2, 3, 4, 5);
    expect(quantileSorted(a, 0)).toBe(1);
    expect(quantileSorted(a, 0.5)).toBe(3);
    expect(quantileSorted(a, 1)).toBe(5);
    expect(quantileSorted(a, 0.125)).toBeCloseTo(1.5, 15);
    expect(quantileSorted(new Float64Array(0), 0.5)).toBeNaN();
  });
  it('ensembleBands orders mean-free bands q025 <= q25 <= median <= q75 <= q975 and rejects empty input', () => {
    const p = params({ population: 2000, initialInfected: 5, horizonDays: 60 });
    const b = ensembleBands(runEnsemble(sopts(p, 3, 'gillespie'), 0, 30), 'I');
    for (let i = 0; i < b.times.length; i++) {
      expect(b.q025[i] as number).toBeLessThanOrEqual(b.q25[i] as number);
      expect(b.q25[i] as number).toBeLessThanOrEqual(b.median[i] as number);
      expect(b.median[i] as number).toBeLessThanOrEqual(b.q75[i] as number);
      expect(b.q75[i] as number).toBeLessThanOrEqual(b.q975[i] as number);
    }
    expect(() => ensembleBands([], 'I')).toThrow(ParamError);
  });
});

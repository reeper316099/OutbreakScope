import { describe, expect, it } from 'vitest';
import type { Intervention } from '../../src/shared/types';
import { buildSchedule } from '../../src/sim/interventions';
import { IDX, STATE_SIZE, makeRhs } from '../../src/sim/models';
import type { Rhs } from '../../src/sim/models';
import { userToInternal } from '../../src/sim/params';
import {
  buildKnots,
  defaultMaxStep,
  makeWorkspace,
  rk4Advance,
  uniformGrid,
} from '../../src/sim/rk4';
import { FIXTURE_IDS, fixtureToScenario, loadFixture, params, run } from './helpers';
import { NumericalError, ParamError } from '../../src/sim/errors';

describe('RK4 convergence order', () => {
  it("linear test problem y' = -y: halving h cuts the error by ~16 (measured order ~ 4)", () => {
    const f: Rhs = (y, out) => {
      out[0] = -(y[0] as number);
    };
    const ws = makeWorkspace(1);
    const err = (n: number): number => {
      const y = Float64Array.of(1);
      rk4Advance(f, y, 2, n, ws);
      return Math.abs((y[0] as number) - Math.exp(-2));
    };
    const errors = [16, 32, 64, 128].map(err);
    const orders = errors.slice(0, -1).map((e, i) => Math.log2(e / (errors[i + 1] as number)));
    for (const o of orders) {
      expect(o).toBeGreaterThan(3.8);
      expect(o).toBeLessThan(4.2);
    }
  });
  it('nonlinear SIR system: order ~ 4 against a very fine RK4 solution (h/64)', () => {
    const rates = userToInternal(
      params({ model: 'SIR', r0: 3, infectiousDays: 5, population: 1000, initialInfected: 10 }),
    );
    const rhs = makeRhs('SIR', rates, 1000, 0, 1, 0);
    const ws = makeWorkspace(STATE_SIZE);
    const solve = (n: number): Float64Array => {
      const y = new Float64Array(STATE_SIZE);
      y[IDX.S] = 990;
      y[IDX.I] = 10;
      rk4Advance(rhs, y, 20, n, ws);
      return y;
    };
    const ref = solve(40 * 64);
    const err = (n: number): number =>
      Math.abs((solve(n)[IDX.I] as number) - (ref[IDX.I] as number));
    const errors = [20, 40, 80].map(err);
    const orders = errors.slice(0, -1).map((e, i) => Math.log2(e / (errors[i + 1] as number)));
    for (const o of orders) {
      expect(o).toBeGreaterThan(3.7);
      expect(o).toBeLessThan(4.4);
    }
  });
  it('default step: 0.1 day cap and (rate * h) <= 0.02', () => {
    expect(defaultMaxStep(0.2)).toBeCloseTo(0.1, 12);
    expect(defaultMaxStep(2)).toBeCloseTo(0.01, 15);
    expect(defaultMaxStep(0.1)).toBe(0.1);
    expect(defaultMaxStep(0)).toBe(0.1);
  });
});

/** Parameter regimes used for conservation / non-negativity checks. */
const regimes: { name: string; p: ReturnType<typeof params>; iv: Intervention[] }[] = [
  { name: 'SIR slow', p: params({ model: 'SIR', r0: 1.5, infectiousDays: 10 }), iv: [] },
  {
    name: 'SIR fast R0=6',
    p: params({ model: 'SIR', r0: 6, infectiousDays: 3, initialInfected: 1 }),
    iv: [],
  },
  {
    name: 'SEIR R0=15 (measles-like)',
    p: params({ r0: 15, incubationDays: 8, infectiousDays: 8, initialInfected: 5 }),
    iv: [],
  },
  { name: 'SEIR R0<1', p: params({ r0: 0.8 }), iv: [] },
  { name: 'SEIR R0=1', p: params({ r0: 1 }), iv: [] },
  {
    name: 'SEIR near-stiff (rate 10/day)',
    p: params({ r0: 5, incubationDays: 0.1, infectiousDays: 0.5, initialInfected: 1 }),
    iv: [],
  },
  { name: 'SEIR tiny population', p: params({ population: 50, initialInfected: 1 }), iv: [] },
  {
    name: 'SEIR + contact reduction',
    p: params(),
    iv: [{ type: 'contact_reduction', startDay: 30, endDay: 120, strength: 0.4 }],
  },
  {
    name: 'SEIRV vaccination + reduction',
    p: params({ model: 'SEIRV', vaccineEfficacy: 0.8, r0: 3 }),
    iv: [
      { type: 'vaccination', startDay: 20, endDay: 90, strength: 0.02 },
      { type: 'contact_reduction', startDay: 50, endDay: 150, strength: 0.3 },
    ],
  },
  {
    name: 'SEIRV perfect vaccine, huge rate',
    p: params({ model: 'SEIRV', vaccineEfficacy: 1 }),
    iv: [{ type: 'vaccination', startDay: 5, endDay: 60, strength: 1 }],
  },
];

describe('conservation and non-negativity', () => {
  for (const { name, p, iv } of regimes) {
    it(`${name}: S+E+I+R+V = N at every output time (tolerance 1e-9 N), nothing negative`, () => {
      const { trajectory: t, stats } = run(p, iv);
      let worst = 0,
        minValue = Infinity;
      for (let i = 0; i < t.times.length; i++) {
        const sum =
          (t.S[i] as number) +
          (t.E[i] as number) +
          (t.I[i] as number) +
          (t.R[i] as number) +
          (t.V[i] as number);
        worst = Math.max(worst, Math.abs(sum - p.population));
        minValue = Math.min(
          minValue,
          t.S[i] as number,
          t.E[i] as number,
          t.I[i] as number,
          t.R[i] as number,
          t.V[i] as number,
        );
      }
      expect(worst).toBeLessThanOrEqual(1e-9 * p.population);
      expect(minValue).toBeGreaterThanOrEqual(0); // any roundoff-level negative value is clamped to exactly 0
      expect(stats.clampedValues).toBeLessThan(50); // clamping is a rare roundoff event, not a way of hiding errors
    });
  }
  it('cumulative infections never decrease and equal E+I+R-type counts for SIR/SEIR without vaccination', () => {
    const { trajectory: t } = run(params({ r0: 3 }));
    for (let i = 1; i < t.times.length; i++)
      expect(t.cumInfections[i] as number).toBeGreaterThanOrEqual(t.cumInfections[i - 1] as number);
    const last = t.times.length - 1;
    expect(t.cumInfections[last] as number).toBeCloseTo(
      (t.E[last] as number) + (t.I[last] as number) + (t.R[last] as number),
      3,
    );
  });
  it('vaccinated count is bounded by cumulative vaccinations, and higher efficacy gives a smaller epidemic', () => {
    const iv: Intervention[] = [{ type: 'vaccination', startDay: 10, endDay: 80, strength: 0.02 }];
    const lo = run(params({ model: 'SEIRV', vaccineEfficacy: 0.2, r0: 3 }), iv).trajectory;
    const hi = run(params({ model: 'SEIRV', vaccineEfficacy: 0.95, r0: 3 }), iv).trajectory;
    for (let i = 0; i < hi.times.length; i++)
      expect(hi.V[i] as number).toBeLessThanOrEqual((hi.cumVaccinated[i] as number) + 1e-6);
    expect(hi.cumInfections[hi.times.length - 1] as number).toBeLessThan(
      lo.cumInfections[lo.times.length - 1] as number,
    );
  });
});

describe('SciPy reference match (DOP853, rtol 1e-10, atol 1e-12)', () => {
  // Tolerance: absolute error <= 1e-7 of N on every compartment at every daily output time.
  const TOL = 1e-7;
  for (const id of FIXTURE_IDS) {
    it(`${id}`, () => {
      const f = loadFixture(id);
      const { p, interventions } = fixtureToScenario(f);
      const { trajectory: t } = run(p, interventions);
      expect(t.times.length).toBe(f.t.length);
      let worst = 0;
      for (let i = 0; i < f.t.length; i++) {
        expect(t.times[i]).toBeCloseTo(f.t[i] as number, 12);
        const ref = f.y[i] as number[];
        const mine = [t.S[i], t.E[i], t.I[i], t.R[i], t.V[i]] as number[];
        for (let c = 0; c < 5; c++)
          worst = Math.max(worst, Math.abs((mine[c] as number) - (ref[c] as number)));
      }
      expect(worst / p.population).toBeLessThan(TOL);
      if (process.env['SHOW_ERRORS'] === '1')
        console.log(id, 'max |error| / N =', worst / p.population);
    });
  }
});

describe('intervention boundaries', () => {
  const contact: Intervention[] = [
    { type: 'contact_reduction', startDay: 30, endDay: 200, strength: 0.4 },
  ];
  it('knots include every boundary exactly, even when no output time falls on it', () => {
    const sched = buildSchedule(contact, 100);
    const { knots } = buildKnots(Float64Array.of(0, 7, 14, 21, 28, 35, 100), sched, 100);
    expect(knots).toContain(30);
    expect(knots).toContain(100);
    expect(knots.indexOf(28) + 1).toBe(knots.indexOf(30)); // 30 sits between 28 and 35: the step from 28 stops at 30
  });
  it('output times within 1e-9 of a boundary snap onto it', () => {
    const sched = buildSchedule(contact, 100);
    const { snapped } = buildKnots(Float64Array.of(0, 30.0000000001, 100), sched, 100);
    expect(snapped[1]).toBe(30);
  });
  it('results do not depend on the output grid (daily vs 5-day vs 0.25-day vs awkward grid), tolerance 1e-7 N', () => {
    const p = params({ horizonDays: 100 });
    const base = run(p, contact).trajectory;
    const sample = (grid: Float64Array) => run(p, contact, { outputTimes: grid }).trajectory;
    const grids = [
      uniformGrid(100, 5),
      uniformGrid(100, 0.25),
      Float64Array.of(0, 13, 29.5, 30, 41.7, 60, 100),
    ];
    for (const g of grids) {
      const t = sample(g);
      for (let k = 0; k < t.times.length; k++) {
        const day = t.times[k] as number;
        if (!Number.isInteger(day)) continue; // compare at days present in the daily reference run
        const j = day; // daily grid index equals the day
        for (const key of ['S', 'E', 'I', 'R'] as const) {
          expect(
            Math.abs((t[key][k] as number) - (base[key][j] as number)) / p.population,
          ).toBeLessThan(1e-7);
        }
      }
    }
  });
  it('a contact reduction starting at day 30 changes the curve from day 30 on, not before', () => {
    const p = params({ horizonDays: 100 });
    const a = run(p, []).trajectory,
      b = run(p, contact).trajectory;
    for (let d = 0; d <= 30; d++) expect(b.I[d]).toBeCloseTo(a.I[d] as number, 8); // identical until the event begins
    expect(Math.abs((b.I[60] as number) - (a.I[60] as number))).toBeGreaterThan(1);
  });
  it('rejects unsorted output times, a grid not starting at 0, and times beyond the horizon', () => {
    const p = params({ horizonDays: 50 });
    expect(() => run(p, [], { outputTimes: Float64Array.of(0, 10, 5) })).toThrow(ParamError);
    expect(() => run(p, [], { outputTimes: Float64Array.of(1, 2) })).toThrow(ParamError);
    expect(() => run(p, [], { outputTimes: Float64Array.of(0, 60) })).toThrow(ParamError);
  });
  it('raises a NumericalError rather than returning garbage when the step is far too large', () => {
    expect(() =>
      run(params({ r0: 5, incubationDays: 0.1, infectiousDays: 0.5, initialInfected: 1 }), [], {
        maxStep: 5,
      }),
    ).toThrow(NumericalError);
  });
});

describe('special regimes', () => {
  it('R0 < 1: infection dies out monotonically and the final size is tiny', () => {
    for (const model of ['SIR', 'SEIR'] as const) {
      const p = params({ model, r0: 0.8, initialInfected: 100, horizonDays: 300 });
      const { trajectory: t } = run(p);
      for (let i = 1; i < t.times.length; i++) {
        const prev = (t.E[i - 1] as number) + (t.I[i - 1] as number),
          cur = (t.E[i] as number) + (t.I[i] as number);
        expect(cur).toBeLessThanOrEqual(prev + 1e-9); // E + I is non-increasing when R0 S/N < 1
      }
      const total = t.cumInfections[t.times.length - 1] as number;
      expect(total).toBeCloseTo(100 / (1 - 0.8), -1); // I0/(1 - R0) = 500 total ever infected (S ~ N), within ~5
      expect(total / p.population).toBeLessThan(1e-3);
    }
  });
  it('R0 = 1 exactly and R0 slightly above 1 run cleanly and stay small', () => {
    for (const r0 of [1, 1.0001, 1.01]) {
      const { trajectory: t } = run(params({ r0, initialInfected: 100, horizonDays: 365 }));
      expect([...t.I].every(Number.isFinite)).toBe(true);
      expect((t.cumInfections[t.times.length - 1] as number) / 1e6).toBeLessThan(0.05);
    }
  });
  it('zero population or zero initial infected are rejected before reaching the solver', () => {
    expect(() => userToInternal(params({ population: 0 }))).toThrow(ParamError);
    expect(() => userToInternal(params({ initialInfected: 0 }))).toThrow(ParamError);
  });
});

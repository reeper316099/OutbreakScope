import { describe, expect, it } from 'vitest';
import {
  generateSynthetic,
  misfitWarnings,
  makeEvaluator,
  expectedCounts,
  goodnessOfFit,
  logPriorU,
  paramSpace,
  posteriorPredictive,
  priorSdU,
  samplePriorU,
  seriesIntervals,
  toNaturalValue,
  toUnbounded,
  DEFAULT_PRIORS,
} from '../../src/sim/fit';
import type { FitConfig, NaturalParams } from '../../src/sim/fit';
import { Rng } from '../../src/sim/rng';
import { fitSeries, modeParams } from '../../src/sim/fitRun';
import type { FitRunOptions } from '../../src/sim/fitRun';

const config = (over: Partial<FitConfig> = {}): FitConfig => ({
  model: 'SEIR',
  population: 1_000_000,
  values: { r0: 2, i0: 20, rho: 0.3, dispersion: 20, incubationDays: 3, infectiousDays: 5 },
  fitted: ['r0', 'i0', 'rho'],
  likelihood: 'poisson',
  reportingDelayDays: 0,
  priors: DEFAULT_PRIORS,
  ...over,
});
const truth = (over: Partial<NaturalParams> = {}): NaturalParams => ({
  r0: 2.2,
  i0: 20,
  rho: 0.3,
  dispersion: 20,
  incubationDays: 3,
  infectiousDays: 5,
  ...over,
});

describe('observation model', () => {
  it('SIR with rho = 1: summed expected counts over a long window equal N * final size (z = 0.7968 at R0 = 2)', () => {
    const c = config({ model: 'SIR' });
    const ivs = Array.from({ length: 400 }, (_, i) => ({ startDay: i, endDay: i + 1 }));
    const mu = expectedCounts(c, truth({ r0: 2, rho: 1, i0: 1, infectiousDays: 5 }), ivs);
    const total = Array.from(mu ?? []).reduce((a, b) => a + b, 0);
    expect(total / 1e6).toBeCloseTo(0.79681213, 3); // new infections after day 0 (the initial case is not counted)
  });
  it('rho scales the expected counts linearly', () => {
    const ivs = [
      { startDay: 10, endDay: 17 },
      { startDay: 20, endDay: 27 },
    ];
    const a = expectedCounts(config(), truth({ rho: 0.2 }), ivs) as Float64Array;
    const b = expectedCounts(config(), truth({ rho: 0.4 }), ivs) as Float64Array;
    expect((b[0] as number) / (a[0] as number)).toBeCloseTo(2, 10);
    expect((b[1] as number) / (a[1] as number)).toBeCloseTo(2, 10);
  });
  it('a reporting delay of d days shifts the curve by d days (and is zero before day 0 + d)', () => {
    const ivs = Array.from({ length: 60 }, (_, i) => ({ startDay: i, endDay: i + 1 }));
    const plain = expectedCounts(config(), truth(), ivs) as Float64Array;
    const delayed = expectedCounts(config({ reportingDelayDays: 5 }), truth(), ivs) as Float64Array;
    for (let i = 10; i < 55; i++)
      expect(delayed[i] as number).toBeCloseTo(plain[i - 5] as number, 8);
    expect(delayed[0]).toBe(0);
    expect(delayed[4]).toBe(0);
  });
  it('invalid or too-stiff parameters give null (probability zero), not garbage', () => {
    const ivs = [{ startDay: 0, endDay: 7 }];
    expect(expectedCounts(config(), truth({ r0: NaN }), ivs)).toBeNull();
    expect(expectedCounts(config(), truth({ rho: 1.5 }), ivs)).toBeNull();
    expect(expectedCounts(config(), truth({ i0: 0 }), ivs)).toBeNull();
    expect(expectedCounts(config(), truth({ r0: 50, infectiousDays: 1 }), ivs)).toBeNull();
  });
});

describe('priors', () => {
  it('prior densities in the unbounded coordinate integrate to 1', () => {
    for (const c of [config(), config({ priors: { ...DEFAULT_PRIORS, rho: { a: 2, b: 5 } } })]) {
      for (const d of paramSpace(c).filter(
        (p) => p.name === 'r0' || p.name === 'rho' || p.name === 'i0',
      )) {
        let s = 0;
        const h = 0.002;
        for (let u = -30; u < 30; u += h) s += Math.exp(logPriorU(d, u)) * h;
        expect(s).toBeCloseTo(1, 3);
      }
    }
  });
  it('prior sd matches sampled sd (including logit(Beta))', () => {
    const rng = Rng.forStream(1, 1);
    for (const name of ['r0', 'rho'] as const) {
      const d = paramSpace(config({ priors: { ...DEFAULT_PRIORS, rho: { a: 2, b: 3 } } })).find(
        (p) => p.name === name,
      );
      if (!d) throw new Error('parameter expected');
      const xs = Array.from({ length: 40_000 }, () => samplePriorU(d, rng));
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
      expect(Math.abs(sd - priorSdU(d)) / priorSdU(d)).toBeLessThan(0.03);
    }
  });
  it('transforms round-trip', () => {
    for (const d of paramSpace(config()))
      expect(toUnbounded(d, toNaturalValue(d, 0.37))).toBeCloseTo(0.37, 12);
  });
});

describe('likelihood surface and synthetic data', () => {
  it('synthetic data are reproducible from the seed and differ across seeds', () => {
    const spec = {
      config: config(),
      truth: truth(),
      intervalDays: 7 as const,
      observations: 20,
      seed: 5,
    };
    expect(generateSynthetic(spec).counts).toEqual(generateSynthetic(spec).counts);
    expect(generateSynthetic({ ...spec, seed: 6 }).counts).not.toEqual(
      generateSynthetic(spec).counts,
    );
  });
  it('the log posterior is higher at the true parameters than at clearly wrong ones', () => {
    const c = config();
    const series = generateSynthetic({
      config: c,
      truth: truth(),
      intervalDays: 7,
      observations: 20,
      seed: 8,
    });
    const ev = makeEvaluator(c, series);
    const uTrue = ev.defs.map((d) =>
      toUnbounded(d, d.name === 'r0' ? 2.2 : d.name === 'i0' ? 20 : 0.3),
    );
    const lpTrue = ev.logPosterior(uTrue);
    expect(Number.isFinite(lpTrue)).toBe(true);
    for (const factor of [
      [1.5, 1, 1],
      [0.7, 1, 1],
      [1, 3, 1],
      [1, 1, 2],
    ]) {
      const bad = uTrue.map((u, i) => u + Math.log(factor[i] as number));
      expect(ev.logPosterior(bad)).toBeLessThan(lpTrue);
    }
    expect(ev.logPosterior([NaN, 0, 0])).toBe(-Infinity);
    expect(ev.logPosterior([100, 0, 0])).toBe(-Infinity);
  });
  it('negative-binomial synthetic data are over-dispersed relative to Poisson', () => {
    const c = config({ likelihood: 'negbin' });
    const s = generateSynthetic({
      config: c,
      truth: truth({ dispersion: 3 }),
      intervalDays: 1,
      observations: 60,
      seed: 2,
    });
    const mu = expectedCounts(c, truth({ dispersion: 3 }), seriesIntervals(s)) as Float64Array;
    const chi =
      s.counts.reduce((a, y, i) => a + (y - (mu[i] as number)) ** 2 / (mu[i] as number), 0) /
      s.counts.length;
    expect(chi).toBeGreaterThan(2);
  });
});

const RUN: FitRunOptions = {
  seed: 99,
  restarts: 5,
  chains: 3,
  burnIn: 1500,
  iterations: 2500,
  thin: 5,
};

describe('fitting', () => {
  it('recovers known parameters from noisy synthetic data (posterior mode within 12% for R0, 25% for rho) and the sampler converges', () => {
    const c = config();
    const t = truth({ r0: 2.4, i0: 15, rho: 0.25 });
    const series = generateSynthetic({
      config: c,
      truth: t,
      intervalDays: 7,
      observations: 26,
      seed: 31,
    });
    const fit = fitSeries(c, series, RUN);
    const m = modeParams(fit);
    expect(Math.abs(m.r0 - 2.4) / 2.4).toBeLessThan(0.12);
    expect(Math.abs(m.rho - 0.25) / 0.25).toBeLessThan(0.25);
    expect(fit.verdict.converged).toBe(true);
  }, 300_000);

  it('coverage over repeated trials: the 95% intervals contain the truth in at least 5 of 6 trials for R0, rho and I0', () => {
    const c = config();
    const hits: Record<string, number> = { r0: 0, i0: 0, rho: 0 };
    const trials = 6;
    const rng = Rng.forStream(404, 1);
    let convergedCount = 0;
    for (let k = 0; k < trials; k++) {
      const t = truth({
        r0: 1.8 + 1.2 * rng.nextFloat(),
        i0: 10 + 20 * rng.nextFloat(),
        rho: 0.15 + 0.3 * rng.nextFloat(),
      });
      const series = generateSynthetic({
        config: c,
        truth: t,
        intervalDays: 7,
        observations: 26,
        seed: 1000 + k,
      });
      const fit = fitSeries(c, series, { ...RUN, seed: 500 + k });
      if (fit.verdict.converged) convergedCount++;
      fit.defs.forEach((d, j) => {
        const trueVal = d.name === 'r0' ? t.r0 : d.name === 'i0' ? t.i0 : t.rho;
        const s = fit.summaries[j] as { q025: number; q975: number };
        if (trueVal >= s.q025 && trueVal <= s.q975) hits[d.name] = (hits[d.name] ?? 0) + 1;
      });
    }
    if (process.env['SHOW_ERRORS'] === '1')
      console.log('coverage hits out of 6:', hits, 'converged fits:', convergedCount);
    for (const name of ['r0', 'i0', 'rho']) expect(hits[name]).toBeGreaterThanOrEqual(5);
    expect(convergedCount).toBeGreaterThanOrEqual(5);
  }, 600_000);

  it('negative-binomial fit recovers an over-dispersed series and estimates a finite dispersion', () => {
    const c = config({ likelihood: 'negbin', fitted: ['r0', 'i0', 'rho', 'dispersion'] });
    const t = truth({ r0: 2.2, dispersion: 5 });
    const series = generateSynthetic({
      config: c,
      truth: t,
      intervalDays: 7,
      observations: 26,
      seed: 77,
    });
    const fit = fitSeries(c, series, RUN);
    expect(fit.defs.map((d) => d.name)).toContain('dispersion');
    const kIdx = fit.defs.findIndex((d) => d.name === 'dispersion');
    const k = fit.summaries[kIdx] as { median: number };
    expect(k.median).toBeGreaterThan(1);
    expect(k.median).toBeLessThan(40);
    const m = modeParams(fit);
    expect(Math.abs(m.r0 - 2.2) / 2.2).toBeLessThan(0.2);
  }, 300_000);

  it('identifiability: data from the early exponential phase only cannot separate I0 from the reporting fraction, and the warning logic triggers', () => {
    const c = config({ priors: { ...DEFAULT_PRIORS, i0: { median: 100, sigmaLog: 2 } } });
    // 16 days of daily data: cumulative infections stay far below 1% of N, so counts ~ rho * I0 * exp(r t) and only the product rho * I0 (and r) is determined.
    const series = generateSynthetic({
      config: c,
      truth: truth({ r0: 2.2, i0: 300, rho: 0.1 }),
      intervalDays: 1,
      observations: 16,
      seed: 12,
    });
    const fit = fitSeries(c, series, {
      ...RUN,
      chains: 3,
      burnIn: 3000,
      iterations: 4000,
      thin: 5,
    });
    const pair = fit.warnings.find(
      (w) => w.kind === 'correlation' && w.params.includes('i0') && w.params.includes('rho'),
    );
    expect(pair).toBeDefined();
    expect(pair?.message).toMatch(/strongly linked/);
    expect(fit.warnings.some((w) => w.kind === 'prior-dominated' || w.kind === 'wide')).toBe(true);
  }, 300_000);

  it('identifiability: when the infectious period is also fitted to a short early series, the data barely move it away from its prior and the app says so', () => {
    const c = config({
      fitted: ['r0', 'i0', 'rho', 'infectious'],
      priors: { ...DEFAULT_PRIORS, infectious: { median: 5, sigmaLog: 0.6 } },
    });
    const series = generateSynthetic({
      config: c,
      truth: truth(),
      intervalDays: 1,
      observations: 16,
      seed: 15,
    });
    const fit = fitSeries(c, series, { ...RUN, burnIn: 3000, iterations: 4000, thin: 5 });
    expect(
      fit.warnings.some((w) => w.kind === 'prior-dominated' && w.params.includes('infectious')),
    ).toBe(true);
  }, 300_000);
});

describe('misfit warnings', () => {
  const base = {
    rmse: 1,
    mae: 1,
    r2: 0.95,
    coverage50: 0.5,
    coverage95: 0.95,
    residuals: [],
    pearsonPerObservation: 1,
  };
  it('stays quiet for a good fit', () => {
    expect(misfitWarnings(base, 'poisson')).toEqual([]);
  });
  it('flags low coverage, over-scatter (with the negative-binomial hint for Poisson) and a low R2', () => {
    const w = misfitWarnings(
      { ...base, coverage95: 0.51, pearsonPerObservation: 12.9, r2: 0.3 },
      'poisson',
    );
    expect(w.length).toBe(3);
    expect(w.join(' ')).toMatch(/too narrow/);
    expect(w.join(' ')).toMatch(/negative-binomial/);
    expect(misfitWarnings({ ...base, pearsonPerObservation: 5 }, 'negbin').join(' ')).not.toMatch(
      /negative-binomial/,
    );
  });
});

describe('predictive bands and goodness of fit', () => {
  it('a good fit covers most observations; bands are ordered', () => {
    const c = config();
    const series = generateSynthetic({
      config: c,
      truth: truth({ r0: 2.4, i0: 15, rho: 0.25 }),
      intervalDays: 7,
      observations: 26,
      seed: 31,
    });
    const fit = fitSeries(c, series, RUN);
    const ev = makeEvaluator(c, series);
    const pred = posteriorPredictive(ev, fit.draws, seriesIntervals(series), 3);
    for (let i = 0; i < series.counts.length; i++) {
      expect(pred.observed.q025[i] as number).toBeLessThanOrEqual(pred.observed.q25[i] as number);
      expect(pred.observed.q25[i] as number).toBeLessThanOrEqual(pred.observed.median[i] as number);
      expect(pred.observed.q75[i] as number).toBeLessThanOrEqual(pred.observed.q975[i] as number);
      expect(pred.expected.median[i] as number).toBeLessThanOrEqual(
        (pred.observed.q975[i] as number) + 1e-9,
      );
      expect(pred.expected.median[i] as number).toBeGreaterThanOrEqual(
        (pred.observed.q025[i] as number) - 1e-9,
      );
    }
    const g = goodnessOfFit(series, pred, 'poisson', Infinity);
    expect(g.coverage95).toBeGreaterThan(0.85);
    expect(g.r2).toBeGreaterThan(0.9);
    expect(g.pearsonPerObservation).toBeGreaterThan(0.3);
    expect(g.pearsonPerObservation).toBeLessThan(3);
    expect(g.residuals.length).toBe(26);
  }, 300_000);
});

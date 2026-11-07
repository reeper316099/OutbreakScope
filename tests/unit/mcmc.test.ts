import { describe, expect, it } from 'vitest';
import { ParamError } from '../../src/sim/errors';
import { Rng } from '../../src/sim/rng';
import {
  ACCEPT_RANGE,
  ESS_MIN,
  RHAT_MAX,
  convergenceVerdict,
  correlation,
  effectiveSampleSize,
  splitRhat,
  summarize,
} from '../../src/sim/diagnostics';
import { cholesky, column, runChain } from '../../src/sim/mcmc';

/** Standard normal log-density (up to a constant). */
const stdNormal = (u: number[]): number => -0.5 * (u[0] as number) ** 2;

describe('Metropolis sampler on known distributions', () => {
  it('standard normal: mean ~0 and variance ~1 (4 chains x 20000 draws; tolerances from the effective sample size)', () => {
    const chains = [0, 1, 2, 3].map((i) =>
      runChain({
        logPosterior: stdNormal,
        start: [i * 3 - 4.5],
        iterations: 20000,
        burnIn: 2000,
        initialSd: [1],
        seed: 7,
        chainIndex: i,
      }),
    );
    const cols = chains.map((c) => column(c, 0));
    const s = summarize(cols);
    const ess = effectiveSampleSize(cols);
    expect(Math.abs(s.mean)).toBeLessThan(4 / Math.sqrt(ess));
    expect(Math.abs(s.sd * s.sd - 1)).toBeLessThan(0.08);
    expect(splitRhat(cols)).toBeLessThan(1.02);
    expect(ess).toBeGreaterThan(2000);
  });
  it('correlated bivariate normal (sd 1 and 3, correlation 0.9): recovers means, variances and correlation', () => {
    const sd1 = 1,
      sd2 = 3,
      r = 0.9;
    const logp = (u: number[]): number => {
      const a = (u[0] as number) / sd1,
        b = (u[1] as number) / sd2;
      return (-0.5 * (a * a - 2 * r * a * b + b * b)) / (1 - r * r);
    };
    const chains = [0, 1, 2, 3].map((i) =>
      runChain({
        logPosterior: logp,
        start: [i - 1.5, (i - 1.5) * 3],
        iterations: 30000,
        burnIn: 5000,
        initialSd: [0.5, 1.5],
        seed: 11,
        chainIndex: i,
      }),
    );
    const x = chains.map((c) => column(c, 0)),
      y = chains.map((c) => column(c, 1));
    const sx = summarize(x),
      sy = summarize(y);
    const rho = correlation(
      Float64Array.from(x.flatMap((c) => Array.from(c))),
      Float64Array.from(y.flatMap((c) => Array.from(c))),
    );
    expect(Math.abs(sx.mean)).toBeLessThan(0.12);
    expect(Math.abs(sy.mean)).toBeLessThan(0.36);
    expect(Math.abs(sx.sd - 1)).toBeLessThan(0.1);
    expect(Math.abs(sy.sd - 3)).toBeLessThan(0.3);
    expect(Math.abs(rho - 0.9)).toBeLessThan(0.03);
    expect(splitRhat(x)).toBeLessThan(1.05);
  });
  it('adapts the proposal during burn-in only and keeps it frozen afterwards', () => {
    const c = runChain({
      logPosterior: stdNormal,
      start: [0],
      iterations: 3000,
      burnIn: 1000,
      initialSd: [0.01],
      seed: 3,
      chainIndex: 0,
    });
    expect(c.adaptationIterations.length).toBeGreaterThan(3);
    expect(Math.max(...c.adaptationIterations)).toBeLessThan(1000);
    expect(c.acceptRatePost).toBeGreaterThan(0.15); // a badly scaled start (sd 0.01 would accept ~99%) was learned away during burn-in
    expect(c.acceptRatePost).toBeLessThan(0.6);
  });
  it('same seed and chain index reproduce exactly; different chain indexes differ', () => {
    const run = (i: number) =>
      runChain({
        logPosterior: stdNormal,
        start: [0],
        iterations: 200,
        burnIn: 100,
        initialSd: [1],
        seed: 5,
        chainIndex: i,
      });
    expect(Array.from(run(0).samples)).toEqual(Array.from(run(0).samples));
    expect(Array.from(run(0).samples)).not.toEqual(Array.from(run(1).samples));
  });
  it('thinning keeps every k-th draw; rejects impossible starts and bad sizes', () => {
    const c = runChain({
      logPosterior: stdNormal,
      start: [0],
      iterations: 1000,
      burnIn: 100,
      initialSd: [1],
      seed: 1,
      chainIndex: 0,
      thin: 10,
    });
    expect(c.logPosterior.length).toBe(100);
    expect(() =>
      runChain({
        logPosterior: () => -Infinity,
        start: [0],
        iterations: 10,
        burnIn: 0,
        initialSd: [1],
        seed: 1,
        chainIndex: 0,
      }),
    ).toThrow(ParamError);
    expect(() =>
      runChain({
        logPosterior: stdNormal,
        start: [0],
        iterations: 10,
        burnIn: 0,
        initialSd: [1, 1],
        seed: 1,
        chainIndex: 0,
      }),
    ).toThrow(ParamError);
  });
  it('cholesky factors a PD matrix and rejects a non-PD one', () => {
    const l = cholesky([
      [4, 2],
      [2, 3],
    ]);
    expect(l?.[0]?.[0]).toBeCloseTo(2, 14);
    expect(l?.[1]?.[0]).toBeCloseTo(1, 14);
    expect(l?.[1]?.[1]).toBeCloseTo(Math.SQRT2, 14);
    expect(
      cholesky([
        [1, 2],
        [2, 1],
      ]),
    ).toBeNull();
  });
});

/** AR(1) series x_t = phi x_{t-1} + sqrt(1-phi^2) e_t, whose true effective sample size is N (1-phi)/(1+phi). */
function ar1(phi: number, n: number, seed: number, stream: number, offset = 0): Float64Array {
  const rng = Rng.forStream(seed, stream);
  const out = new Float64Array(n);
  let x = rng.normal();
  for (let i = 0; i < n; i++) {
    x = phi * x + Math.sqrt(1 - phi * phi) * rng.normal();
    out[i] = x + offset;
  }
  return out;
}

describe('R-hat and effective sample size behave sensibly', () => {
  it('good chains (independent normals): R-hat ~1 and ESS ~ number of draws', () => {
    const chains = [0, 1, 2, 3].map((i) => ar1(0, 2000, 21, i));
    expect(splitRhat(chains)).toBeLessThan(1.01);
    const ess = effectiveSampleSize(chains);
    expect(ess).toBeGreaterThan(0.8 * 8000);
    expect(ess).toBeLessThan(1.6 * 8000);
  });
  it('autocorrelated chains (phi = 0.9): ESS ~ N (1-phi)/(1+phi) = 421 for N = 8000, within a factor of 1.5', () => {
    const chains = [0, 1, 2, 3].map((i) => ar1(0.9, 2000, 22, i));
    const ess = effectiveSampleSize(chains);
    expect(ess).toBeGreaterThan(421 / 1.5);
    expect(ess).toBeLessThan(421 * 1.5);
  });
  it('deliberately bad chains stuck in different places: R-hat is huge and the verdict says NOT converged', () => {
    const chains = [0, 3, 6, 9].map((off, i) => ar1(0.5, 1000, 23, i, off));
    const rhat = splitRhat(chains);
    expect(rhat).toBeGreaterThan(2);
    const v = convergenceVerdict([{ name: 'R0', rhat, ess: effectiveSampleSize(chains) }], [0.3]);
    expect(v.converged).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/R-hat/);
  });
  it('a drifting (non-stationary) chain is caught by splitting chains in half', () => {
    const drift = [0, 1].map((i) =>
      Float64Array.from(ar1(0, 1000, 24, i), (v, t) => v * 0.3 + t / 250),
    );
    expect(splitRhat(drift)).toBeGreaterThan(RHAT_MAX);
  });
  it('verdict thresholds: converged when R-hat < 1.05 and ESS >= 200; low ESS fails; odd acceptance only warns', () => {
    expect(convergenceVerdict([{ name: 'a', rhat: 1.01, ess: 500 }], [0.25]).converged).toBe(true);
    expect(
      convergenceVerdict([{ name: 'a', rhat: 1.01, ess: ESS_MIN - 1 }], [0.25]).converged,
    ).toBe(false);
    expect(convergenceVerdict([{ name: 'a', rhat: RHAT_MAX, ess: 500 }], [0.25]).converged).toBe(
      false,
    );
    const w = convergenceVerdict([{ name: 'a', rhat: 1.01, ess: 500 }], [ACCEPT_RANGE[0] - 0.05]);
    expect(w.converged).toBe(true);
    expect(w.warnings.length).toBe(1);
    expect(convergenceVerdict([{ name: 'a', rhat: NaN, ess: NaN }], []).converged).toBe(false);
  });
  it('degenerate inputs: constant chains and too-short chains', () => {
    expect(splitRhat([new Float64Array(100).fill(2), new Float64Array(100).fill(2)])).toBe(1);
    expect(splitRhat([new Float64Array(100).fill(2), new Float64Array(100).fill(3)])).toBe(
      Infinity,
    );
    expect(splitRhat([Float64Array.of(1, 2)])).toBeNaN();
    expect(effectiveSampleSize([Float64Array.of(1, 2, 3), Float64Array.of(2, 3, 4)])).toBeNaN();
  });
  it('summarize and correlation', () => {
    const s = summarize([Float64Array.of(1, 2, 3, 4, 5)]);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 14);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 14);
  });
});

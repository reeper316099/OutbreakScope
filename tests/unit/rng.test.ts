import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ParamError } from '../../src/sim/errors';
import { Rng, deriveState, logFactorial } from '../../src/sim/rng';

const kat = z
  .object({
    raw_state_1_2_3_4: z.object({ state: z.array(z.number()), u32: z.array(z.number()) }),
    streams: z.array(
      z.object({
        seed: z.number(),
        stream: z.number(),
        state: z.array(z.number()),
        u32: z.array(z.number()),
        floats: z.array(z.number()),
      }),
    ),
  })
  .parse(
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../fixtures/rng_kat.json'), 'utf8')),
  );

describe('xoshiro128** known answers (vectors from tools/gen_rng_kat.py, an independent Python implementation)', () => {
  it('raw generator from state {1,2,3,4} matches the reference algorithm', () => {
    const [a, b, c, d] = kat.raw_state_1_2_3_4.state as [number, number, number, number];
    const rng = new Rng(a, b, c, d);
    expect(kat.raw_state_1_2_3_4.u32.map(() => rng.nextU32())).toEqual(kat.raw_state_1_2_3_4.u32);
    expect(kat.raw_state_1_2_3_4.u32.slice(0, 4)).toEqual([11520, 0, 5927040, 70819200]);
  });
  it('seed/stream derivation and first outputs match for several (seed, stream) pairs', () => {
    for (const v of kat.streams) {
      expect(deriveState(v.seed, v.stream)).toEqual(v.state);
      const rng = Rng.forStream(v.seed, v.stream);
      expect(v.u32.map(() => rng.nextU32())).toEqual(v.u32);
      const rng2 = Rng.forStream(v.seed, v.stream);
      expect(v.floats.map(() => rng2.nextFloat())).toEqual(v.floats);
    }
  });
});

describe('Rng basics', () => {
  it('is reproducible; different seeds and streams differ', () => {
    const a = Rng.forStream(7, 3),
      b = Rng.forStream(7, 3),
      c = Rng.forStream(8, 3),
      d = Rng.forStream(7, 4);
    const xs = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(xs);
    expect(Array.from({ length: 5 }, () => d.nextU32())).not.toEqual(xs);
  });
  it('rejects bad seeds, streams and the all-zero state', () => {
    for (const seed of [-1, 1.5, NaN, 2 ** 32])
      expect(() => Rng.forStream(seed)).toThrow(ParamError);
    expect(() => Rng.forStream(1, -1)).toThrow(ParamError);
    expect(() => new Rng(0, 0, 0, 0)).toThrow(ParamError);
  });
  it('uniform floats pass a chi-square test (10 bins, 200k draws; critical value 27.9 at p = 0.001) and have tiny serial correlation', () => {
    const rng = Rng.forStream(2024, 0);
    const n = 200_000;
    const bins = new Array<number>(10).fill(0);
    let prev = rng.nextFloat(),
      sxy = 0,
      sx = 0,
      sxx = 0;
    for (let i = 0; i < n; i++) {
      const u = rng.nextFloat();
      expect(u >= 0 && u < 1).toBe(true);
      bins[Math.floor(u * 10)] = (bins[Math.floor(u * 10)] as number) + 1;
      sxy += prev * u;
      sx += u;
      sxx += u * u;
      prev = u;
    }
    const chi2 = bins.reduce((acc, o) => acc + (o - n / 10) ** 2 / (n / 10), 0);
    expect(chi2).toBeLessThan(27.9);
    const mean = sx / n,
      cov = sxy / n - mean * mean,
      variance = sxx / n - mean * mean;
    expect(Math.abs(cov / variance)).toBeLessThan(0.01); // lag-1 autocorrelation; standard error is about 0.002
  });
  it('different streams of one seed are uncorrelated', () => {
    const a = Rng.forStream(5, 0),
      b = Rng.forStream(5, 1);
    const n = 100_000;
    let sxy = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0;
    for (let i = 0; i < n; i++) {
      const x = a.nextFloat(),
        y = b.nextFloat();
      sxy += x * y;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
    }
    const r =
      (sxy / n - (sx / n) * (sy / n)) /
      Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    expect(Math.abs(r)).toBeLessThan(0.012); // standard error is about 0.003
  });
  it('exponential draws have mean 1/rate', () => {
    const rng = Rng.forStream(9, 0);
    let s = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) s += rng.exponential(4);
    expect(s / n).toBeCloseTo(0.25, 2); // standard error 0.25/sqrt(n) = 0.0008
  });
});

/** Binomial pmf from log-factorials. */
function binomPmf(n: number, p: number, k: number): number {
  return Math.exp(
    logFactorial(n) -
      logFactorial(k) -
      logFactorial(n - k) +
      k * Math.log(p) +
      (n - k) * Math.log1p(-p),
  );
}

describe('Rng.binomial', () => {
  const cases: [number, number][] = [
    [10, 0.3],
    [100, 0.3],
    [1000, 0.5],
    [50, 0.9],
    [200, 0.05],
    [30, 0.5],
  ];
  for (const [n, p] of cases) {
    it(`Binomial(${n}, ${p}): mean/variance within 4 standard errors and pmf chi-square ok`, () => {
      const rng = Rng.forStream(31337, n);
      const draws = 100_000;
      const counts = new Map<number, number>();
      let s = 0,
        ss = 0;
      for (let i = 0; i < draws; i++) {
        const x = rng.binomial(n, p);
        expect(Number.isInteger(x) && x >= 0 && x <= n).toBe(true);
        counts.set(x, (counts.get(x) ?? 0) + 1);
        s += x;
        ss += x * x;
      }
      const mean = s / draws,
        variance = ss / draws - mean * mean;
      const sd = Math.sqrt(n * p * (1 - p));
      expect(Math.abs(mean - n * p)).toBeLessThan((4 * sd) / Math.sqrt(draws));
      expect(Math.abs(variance - sd * sd) / (sd * sd)).toBeLessThan(0.05);
      // Pearson chi-square over cells with expected count >= 10 (tail cells pooled into one residual cell).
      let chi2 = 0,
        cells = 0,
        pooledExp = 1,
        pooledObs = 0;
      for (let k = 0; k <= n; k++) {
        const e = draws * binomPmf(n, p, k);
        if (e >= 10) {
          chi2 += ((counts.get(k) ?? 0) - e) ** 2 / e;
          cells++;
          pooledExp -= e / draws;
        } else pooledObs += counts.get(k) ?? 0;
      }
      if (pooledExp * draws > 10) {
        chi2 += (pooledObs - pooledExp * draws) ** 2 / (pooledExp * draws);
        cells++;
      }
      const df = cells - 1;
      expect(chi2).toBeLessThan(df + 5 * Math.sqrt(2 * df)); // generous: about p < 1e-5 for a correct sampler
    });
  }
  it('large n: Binomial(1e6, 0.1) has the right mean and sd', () => {
    const rng = Rng.forStream(1, 1);
    const draws = 20_000;
    let s = 0,
      ss = 0;
    for (let i = 0; i < draws; i++) {
      const x = rng.binomial(1_000_000, 0.1);
      s += x;
      ss += x * x;
    }
    const mean = s / draws,
      sd = Math.sqrt(ss / draws - mean * mean);
    expect(Math.abs(mean - 100_000)).toBeLessThan((4 * 300) / Math.sqrt(draws)); // true sd = sqrt(90000) = 300
    expect(Math.abs(sd - 300) / 300).toBeLessThan(0.03);
  });
  it('handles edge cases and rejects invalid arguments', () => {
    const rng = Rng.forStream(1);
    expect(rng.binomial(0, 0.5)).toBe(0);
    expect(rng.binomial(10, 0)).toBe(0);
    expect(rng.binomial(10, 1)).toBe(10);
    expect(() => rng.binomial(-1, 0.5)).toThrow(ParamError);
    expect(() => rng.binomial(1.5, 0.5)).toThrow(ParamError);
    expect(() => rng.binomial(10, NaN)).toThrow(ParamError);
    expect(() => rng.binomial(10, 1.1)).toThrow(ParamError);
  });
});

describe('logFactorial', () => {
  it('matches known values and the Stirling branch matches a direct sum', () => {
    expect(logFactorial(0)).toBe(0);
    expect(logFactorial(10)).toBeCloseTo(15.104412573075516, 12);
    for (const n of [257, 1000, 100000]) {
      let direct = 0;
      for (let i = 2; i <= n; i++) direct += Math.log(i);
      expect(Math.abs(logFactorial(n) - direct) / direct).toBeLessThan(1e-12);
    }
  });
});

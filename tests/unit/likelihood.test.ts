import { describe, expect, it } from 'vitest';
import {
  countVariance,
  logLikelihood,
  negbinLogPmf,
  poissonLogPmf,
} from '../../src/sim/likelihood';
import { Rng } from '../../src/sim/rng';
import { invLogit, logBeta, logGamma, logit, trigamma } from '../../src/sim/special';

describe('special functions', () => {
  it('logGamma matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 13);
    expect(logGamma(2)).toBeCloseTo(0, 13);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 13);
    expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 13); // Gamma(1/2) = sqrt(pi)
    expect(logGamma(101)).toBeCloseTo(363.73937555556347, 10); // ln(100!)
    expect(logGamma(0.1)).toBeCloseTo(2.252712651734206, 12);
    expect(logGamma(-1)).toBeNaN();
  });
  it('trigamma matches known values: psi1(1) = pi^2/6, psi1(1/2) = pi^2/2', () => {
    expect(trigamma(1)).toBeCloseTo(Math.PI ** 2 / 6, 9);
    expect(trigamma(0.5)).toBeCloseTo(Math.PI ** 2 / 2, 9);
  });
  it('logBeta, logit and invLogit', () => {
    expect(logBeta(2, 3)).toBeCloseTo(Math.log(1 / 12), 12); // B(2,3) = 1!2!/4! = 1/12
    expect(invLogit(logit(0.3))).toBeCloseTo(0.3, 14);
    expect(invLogit(-800)).toBe(0);
    expect(invLogit(800)).toBe(1);
  });
});

describe('log-likelihoods against hand-computed values', () => {
  it('Poisson: y=3, mu=2 -> 3 ln2 - 2 - ln6', () => {
    expect(poissonLogPmf(3, 2)).toBeCloseTo(3 * Math.log(2) - 2 - Math.log(6), 13);
    expect(poissonLogPmf(0, 1.5)).toBeCloseTo(-1.5, 14);
    expect(poissonLogPmf(0, 0)).toBe(0);
    expect(poissonLogPmf(2, 0)).toBe(-Infinity);
  });
  it('Poisson pmf sums to 1', () => {
    let s = 0;
    for (let y = 0; y < 80; y++) s += Math.exp(poissonLogPmf(y, 7.3));
    expect(s).toBeCloseTo(1, 12);
  });
  it('Negative binomial with k = 1 is geometric: y=2, mu=1 -> pmf = (1/2)(1/2)^2 = 1/8', () => {
    expect(negbinLogPmf(2, 1, 1)).toBeCloseTo(Math.log(1 / 8), 13);
  });
  it('Negative binomial: y=0 gives (k/(k+mu))^k; pmf sums to 1 and has mean mu, variance mu + mu^2/k', () => {
    expect(negbinLogPmf(0, 3, 2)).toBeCloseTo(2 * Math.log(2 / 5), 13);
    let s = 0,
      m = 0,
      v = 0;
    for (let y = 0; y < 2000; y++) {
      const p = Math.exp(negbinLogPmf(y, 6, 2.5));
      s += p;
      m += y * p;
      v += y * y * p;
    }
    expect(s).toBeCloseTo(1, 10);
    expect(m).toBeCloseTo(6, 8);
    expect(v - m * m).toBeCloseTo(6 + 36 / 2.5, 6);
  });
  it('Negative binomial approaches Poisson as k grows', () => {
    expect(negbinLogPmf(4, 3, 1e8)).toBeCloseTo(poissonLogPmf(4, 3), 6);
  });
  it('total log-likelihood adds terms and floors tiny expectations', () => {
    expect(logLikelihood('poisson', [3, 0], [2, 1.5])).toBeCloseTo(
      poissonLogPmf(3, 2) + poissonLogPmf(0, 1.5),
      14,
    );
    expect(Number.isFinite(logLikelihood('poisson', [0, 0], [0, 0]))).toBe(true);
    expect(logLikelihood('negbin', [2], [1], 1)).toBeCloseTo(Math.log(1 / 8), 13);
  });
  it('count variance: mu for Poisson, mu + mu^2/k for negbin', () => {
    expect(countVariance('poisson', 5)).toBe(5);
    expect(countVariance('negbin', 5, 2)).toBe(5 + 12.5);
  });
});

describe('Rng: normal, gamma, poisson, negative binomial (moments within 4 standard errors)', () => {
  const n = 200_000;
  const moments = (draw: () => number): { mean: number; variance: number; skew: number } => {
    let s = 0,
      s2 = 0,
      s3 = 0;
    for (let i = 0; i < n; i++) {
      const x = draw();
      s += x;
      s2 += x * x;
      s3 += x * x * x;
    }
    const mean = s / n,
      variance = s2 / n - mean * mean;
    return { mean, variance, skew: (s3 / n - 3 * mean * variance - mean ** 3) / variance ** 1.5 };
  };
  it('normal: mean 0, variance 1, skew 0', () => {
    const rng = Rng.forStream(1, 1);
    const m = moments(() => rng.normal());
    expect(Math.abs(m.mean)).toBeLessThan(4 / Math.sqrt(n));
    expect(Math.abs(m.variance - 1)).toBeLessThan(4 * Math.sqrt(2 / n));
    expect(Math.abs(m.skew)).toBeLessThan(0.03);
  });
  for (const shape of [0.4, 1, 3.5, 20]) {
    it(`gamma(shape ${shape}): mean = variance = shape`, () => {
      const rng = Rng.forStream(2, 2);
      const m = moments(() => rng.gamma(shape));
      expect(Math.abs(m.mean - shape)).toBeLessThan((4 * Math.sqrt(shape)) / Math.sqrt(n));
      expect(Math.abs(m.variance - shape) / shape).toBeLessThan(0.04);
    });
  }
  for (const mu of [0.5, 4, 25, 400]) {
    it(`poisson(${mu}): mean = variance = mu`, () => {
      const rng = Rng.forStream(3, 3);
      const m = moments(() => rng.poisson(mu));
      expect(Math.abs(m.mean - mu)).toBeLessThan((4 * Math.sqrt(mu)) / Math.sqrt(n));
      expect(Math.abs(m.variance - mu) / mu).toBeLessThan(0.04);
    });
  }
  it('negative binomial(mu = 10, k = 2): mean 10, variance 60', () => {
    const rng = Rng.forStream(4, 4);
    const m = moments(() => rng.negativeBinomial(10, 2));
    expect(Math.abs(m.mean - 10)).toBeLessThan((4 * Math.sqrt(60)) / Math.sqrt(n));
    expect(Math.abs(m.variance - 60) / 60).toBeLessThan(0.06);
  });
  it('reject invalid arguments', () => {
    const rng = Rng.forStream(5);
    expect(() => rng.gamma(0)).toThrow();
    expect(() => rng.poisson(-1)).toThrow();
    expect(() => rng.negativeBinomial(1, 0)).toThrow();
    expect(rng.poisson(0)).toBe(0);
  });
});

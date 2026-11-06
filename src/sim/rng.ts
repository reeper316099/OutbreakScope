// Seeded, documented PRNG. No Math.random anywhere in simulation code.
//
// Generator: xoshiro128** (Blackman & Vigna 2018, public domain; https://prng.di.unimi.it/xoshiro128starstar.c)
//   128-bit state (four uint32), 32-bit output.
// Seeding: a user seed (uint32, shown in the UI as a decimal number) and a stream index are absorbed into a
//   128-bit state with the murmur3 finalizer (fmix32). Realization i of a run uses stream i, so results do not
//   depend on how realizations are divided among workers. Streams are hash-derived (not provably disjoint);
//   with a 128-bit state and a few thousand streams the chance of overlap is negligible.
import { ParamError } from './errors';

/** 32-bit left rotation. */
function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Murmur3 32-bit finalizer: a bijective bit mixer, so different inputs never collide. */
function fmix32(h0: number): number {
  let h = h0 >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const GOLDEN = 0x9e3779b9;
const TWO_POW_32 = 4294967296;

/** Derives four state words from (seed, stream); the same inputs always give the same state. */
export function deriveState(seed: number, stream: number): [number, number, number, number] {
  const w: number[] = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344]; // hex digits of pi: arbitrary non-zero start
  const absorb = (x: number): void => {
    for (let j = 0; j < 4; j++)
      w[j] = fmix32(((w[j] as number) ^ x ^ Math.imul(j + 1, GOLDEN)) >>> 0);
    for (let round = 0; round < 2; round++) {
      for (let j = 0; j < 4; j++) {
        const next = (j + 1) & 3;
        w[next] = ((w[next] as number) + rotl(w[j] as number, 7 + j)) >>> 0;
      }
    }
  };
  absorb(seed >>> 0);
  absorb(stream >>> 0);
  absorb(0x5bd1e995);
  return [w[0] as number, w[1] as number, w[2] as number, w[3] as number];
}

// ln(n!) for small n, exact (cumulative sum of logs); larger n use Stirling's series.
const LOG_FACT_TABLE: number[] = (() => {
  const t: number[] = [0];
  for (let i = 1; i <= 256; i++) t.push((t[i - 1] as number) + Math.log(i));
  return t;
})();

/** ln(n!) for integer n >= 0; Stirling series with 1/(12n), 1/(360 n^3), 1/(1260 n^5) terms (error < 1e-15 for n > 256). */
export function logFactorial(n: number): number {
  if (n <= 256) return LOG_FACT_TABLE[n] as number;
  const n2 = n * n;
  return (
    n * Math.log(n) -
    n +
    0.5 * Math.log(2 * Math.PI * n) +
    1 / (12 * n) -
    1 / (360 * n * n2) +
    1 / (1260 * n * n2 * n2)
  );
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** Creates a generator from an explicit 128-bit state (must not be all zero). */
  constructor(s0: number, s1: number, s2: number, s3: number) {
    if ((s0 | s1 | s2 | s3) === 0)
      throw new ParamError('rng', 'out_of_range', 'xoshiro state must not be all zero.');
    this.s0 = s0 >>> 0;
    this.s1 = s1 >>> 0;
    this.s2 = s2 >>> 0;
    this.s3 = s3 >>> 0;
  }

  /** Generator for (seed, stream); seed must be an integer in [0, 2^32). */
  static forStream(seed: number, stream = 0): Rng {
    if (!Number.isInteger(seed) || seed < 0 || seed >= TWO_POW_32)
      throw new ParamError('seed', 'out_of_range', 'Seed must be an integer from 0 to 4294967295.');
    if (!Number.isInteger(stream) || stream < 0 || stream >= TWO_POW_32)
      throw new ParamError(
        'stream',
        'out_of_range',
        'Stream index must be a non-negative 32-bit integer.',
      );
    const [a, b, c, d] = deriveState(seed, stream);
    return new Rng(a, b, c, d);
  }

  /** Next 32 random bits as an unsigned integer (xoshiro128** step). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform double in [0, 1) with 53 random bits (two 32-bit draws). */
  nextFloat(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992; // (hi * 2^26 + lo) / 2^53
  }

  /** Exponential waiting time with the given rate (> 0): -ln(1 - U) / rate. */
  exponential(rate: number): number {
    return -Math.log(1 - this.nextFloat()) / rate;
  }

  /** Exact Binomial(n, p) draw: inversion when n*min(p,1-p) < 10, otherwise BTRS (Hormann 1993, transformed rejection). */
  binomial(n: number, p: number): number {
    if (!Number.isInteger(n) || n < 0)
      throw new ParamError('n', 'not_integer', 'Binomial n must be a non-negative integer.');
    if (!(p >= 0 && p <= 1))
      throw new ParamError('p', 'out_of_range', 'Binomial p must be in [0, 1].');
    if (n === 0 || p === 0) return 0;
    if (p === 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p); // symmetry keeps p <= 1/2
    const np = n * p;
    if (np < 10) return this.binomialInversion(n, p);
    return this.binomialBtrs(n, p);
  }

  /** Inversion by sequential search from 0: P(X=0)=q^n, then P(x)=P(x-1)*((n+1)p/q/x - p/q). */
  private binomialInversion(n: number, p: number): number {
    const q = 1 - p;
    const s = p / q;
    const a = (n + 1) * s;
    let r = Math.exp(n * Math.log1p(-p));
    let u = this.nextFloat();
    let x = 0;
    while (u > r) {
      u -= r;
      x++;
      if (x >= n) return n;
      r *= a / x - s;
    }
    return x;
  }

  /** BTRS: transformed rejection with squeeze; exact for n*p >= 10, p <= 1/2. */
  private binomialBtrs(n: number, p: number): number {
    const spq = Math.sqrt(n * p * (1 - p));
    const b = 1.15 + 2.53 * spq;
    const a = -0.0873 + 0.0248 * b + 0.01 * p;
    const c = n * p + 0.5;
    const vr = 0.92 - 4.2 / b;
    const alpha = (2.83 + 5.1 / b) * spq;
    const lpq = Math.log(p / (1 - p));
    const m = Math.floor((n + 1) * p);
    const h = logFactorial(m) + logFactorial(n - m);
    for (;;) {
      const u = this.nextFloat() - 0.5;
      let v = this.nextFloat();
      const us = 0.5 - Math.abs(u);
      const k = Math.floor(((2 * a) / us + b) * u + c);
      if (k < 0 || k > n) continue;
      if (us >= 0.07 && v <= vr) return k;
      if (v === 0) continue;
      v = Math.log((v * alpha) / (a / (us * us) + b));
      if (v <= h - logFactorial(k) - logFactorial(n - k) + (k - m) * lpq) return k;
    }
  }
}

// Random-walk Metropolis sampler with an adaptive proposal covariance that is learned during burn-in only.
// After burn-in the proposal is frozen, so the post-burn-in chain is a valid Markov chain targeting the posterior.
import { ParamError } from './errors';
import { Rng } from './rng';

export interface ChainOptions {
  /** Log of the (unnormalised) posterior density; may return -Infinity or NaN for invalid points (they are rejected). */
  logPosterior: (u: number[]) => number;
  start: number[];
  /** Post-burn-in iterations to run. */
  iterations: number;
  burnIn: number;
  /** Initial proposal standard deviation for each coordinate. */
  initialSd: number[];
  /** Optional starting proposal covariance (e.g. from the curvature at the optimum); adapted during burn-in like the default. */
  initialCov?: number[][];
  /** Keep every `thin`-th post-burn-in draw (default 1). */
  thin?: number;
  /** Adapt every this many burn-in iterations (default 100). */
  adaptInterval?: number;
  seed: number;
  chainIndex: number;
  onProgress?: (done: number, total: number) => void;
}

export interface ChainResult {
  dim: number;
  /** Kept draws, row-major: draw r, coordinate j -> samples[r*dim + j]. */
  samples: Float64Array;
  logPosterior: Float64Array;
  acceptRateBurnIn: number;
  acceptRatePost: number;
  /** Iterations (0-based, within burn-in) at which the proposal was adapted; all are < burnIn. */
  adaptationIterations: number[];
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix, or null if it is not positive definite. */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = (a[i] as number[])[j] as number;
      for (let k = 0; k < j; k++)
        sum -= ((l[i] as number[])[k] as number) * ((l[j] as number[])[k] as number);
      if (i === j) {
        if (!(sum > 1e-300)) return null;
        (l[i] as number[])[j] = Math.sqrt(sum);
      } else (l[i] as number[])[j] = sum / ((l[j] as number[])[j] as number);
    }
  }
  return l;
}

/** Runs one Metropolis chain; chain `chainIndex` uses its own PRNG stream so chains are independent and reproducible. */
export function runChain(opts: ChainOptions): ChainResult {
  const d = opts.start.length;
  if (opts.initialSd.length !== d)
    throw new ParamError('initialSd', 'out_of_range', 'initialSd needs one value per parameter.');
  const rng = Rng.forStream(opts.seed, 100_000 + opts.chainIndex);
  const thin = opts.thin ?? 1;
  const adaptInterval = opts.adaptInterval ?? 100;
  const total = opts.burnIn + opts.iterations;
  const nKeep = Math.floor(opts.iterations / thin);
  const samples = new Float64Array(nKeep * d);
  const lp = new Float64Array(nKeep);
  let x = [...opts.start];
  let fx = opts.logPosterior(x);
  if (!Number.isFinite(fx))
    throw new ParamError(
      'start',
      'out_of_range',
      'The chain starting point has zero posterior probability.',
    );
  let chol: number[][] = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? (opts.initialSd[i] as number) : 0)),
  );
  // Running mean / covariance of the burn-in history (Welford, multivariate).
  let count = 0;
  const mean = new Array<number>(d).fill(0);
  const m2: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  let scale = 1;
  let windowAccepts = 0;
  let windowCount = 0;
  let acceptBurn = 0;
  let acceptPost = 0;
  let kept = 0;
  const adaptationIterations: number[] = [];
  const z = new Array<number>(d).fill(0);
  for (let it = 0; it < total; it++) {
    const inBurn = it < opts.burnIn;
    for (let j = 0; j < d; j++) z[j] = rng.normal();
    const prop = x.map((xj, i) => {
      let step = 0;
      for (let k = 0; k <= i; k++) step += ((chol[i] as number[])[k] as number) * (z[k] as number);
      return xj + scale * step;
    });
    const fp = opts.logPosterior(prop);
    const accept = Number.isFinite(fp) && Math.log(1 - rng.nextFloat()) < fp - fx;
    if (accept) {
      x = prop;
      fx = fp;
    }
    if (inBurn) {
      if (accept) acceptBurn++;
      windowCount++;
      if (accept) windowAccepts++;
      count++;
      const delta = x.map((xj, j) => xj - (mean[j] as number));
      for (let j = 0; j < d; j++) mean[j] = (mean[j] as number) + (delta[j] as number) / count;
      for (let i = 0; i < d; i++)
        for (let j = 0; j < d; j++)
          (m2[i] as number[])[j] =
            ((m2[i] as number[])[j] as number) +
            (delta[i] as number) * ((x[j] as number) - (mean[j] as number));
      if ((it + 1) % adaptInterval === 0 && count >= 2 * d + 20) {
        const rate = windowAccepts / windowCount;
        scale *= rate < 0.15 ? 0.7 : rate > 0.35 ? 1.4 : 1; // steer the acceptance rate towards ~0.234
        const factor = (2.38 * 2.38) / d;
        const cov = m2.map((row, i) =>
          row.map((v, j) => (factor * v) / (count - 1) + (i === j ? 1e-10 : 0)),
        );
        const l = cholesky(cov);
        if (l !== null) {
          chol = l;
          adaptationIterations.push(it);
        }
        windowAccepts = 0;
        windowCount = 0;
      }
    } else {
      if (accept) acceptPost++;
      const post = it - opts.burnIn;
      if ((post + 1) % thin === 0 && kept < nKeep) {
        samples.set(x, kept * d);
        lp[kept] = fx;
        kept++;
      }
    }
    if (opts.onProgress && (it + 1) % 200 === 0) opts.onProgress(it + 1, total);
  }
  opts.onProgress?.(total, total);
  return {
    dim: d,
    samples,
    logPosterior: lp,
    acceptRateBurnIn: opts.burnIn > 0 ? acceptBurn / opts.burnIn : NaN,
    acceptRatePost: opts.iterations > 0 ? acceptPost / opts.iterations : NaN,
    adaptationIterations,
  };
}

/** Extracts coordinate j of every kept draw as a plain array. */
export function column(result: ChainResult, j: number): Float64Array {
  const n = result.logPosterior.length;
  const out = new Float64Array(n);
  for (let r = 0; r < n; r++) out[r] = result.samples[r * result.dim + j] as number;
  return out;
}

/** Inverse of a symmetric positive-definite matrix via Cholesky; null if the matrix is not positive definite. */
export function invertSpd(a: number[][]): number[][] | null {
  const n = a.length;
  const l = cholesky(a);
  if (l === null) return null;
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let c = 0; c < n; c++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = i === c ? 1 : 0;
      for (let k = 0; k < i; k++) sum -= ((l[i] as number[])[k] as number) * (y[k] as number);
      y[i] = sum / ((l[i] as number[])[i] as number);
    }
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i] as number;
      for (let k = i + 1; k < n; k++) sum -= ((l[k] as number[])[i] as number) * (x[k] as number);
      x[i] = sum / ((l[i] as number[])[i] as number);
    }
    for (let i = 0; i < n; i++) (inv[i] as number[])[c] = x[i] as number;
  }
  return inv;
}

/**
 * Approximate posterior covariance at a mode: the inverse of the finite-difference Hessian of f = -log posterior.
 * A growing ridge is added to the diagonal until the Hessian is positive definite (flat directions get large variance).
 */
export function covarianceAtMode(f: (x: number[]) => number, x: number[], h = 1e-3): number[][] {
  const d = x.length;
  const f0 = f(x);
  const at = (di: number, dj: number, a: number, b: number): number => {
    const y = [...x];
    y[di] = (y[di] as number) + a;
    y[dj] = (y[dj] as number) + b;
    return f(y);
  };
  const H: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    (H[i] as number[])[i] = (at(i, i, h, 0) - 2 * f0 + at(i, i, -h, 0)) / (h * h);
    for (let j = i + 1; j < d; j++) {
      const v =
        (at(i, j, h, h) - at(i, j, h, -h) - at(i, j, -h, h) + at(i, j, -h, -h)) / (4 * h * h);
      (H[i] as number[])[j] = v;
      (H[j] as number[])[i] = v;
    }
  }
  for (let ridge = 1e-6; ridge < 1e6; ridge *= 10) {
    const reg = H.map((row, i) => row.map((v, j) => (i === j ? v + ridge : v)));
    const inv = invertSpd(reg);
    if (inv !== null && inv.every((row, i) => (row[i] as number) > 0)) return inv;
  }
  return H.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
}

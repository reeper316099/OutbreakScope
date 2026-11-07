// MCMC diagnostics: split R-hat, effective sample size, summaries and a convergence verdict with stated thresholds.
// R-hat = a check that independent runs agree with each other; near 1.00 means they do.
// ESS   = how many independent draws the (correlated) chain is worth.
import { quantileSorted } from './stochastic';

export const RHAT_MAX = 1.05;
export const ESS_MIN = 200;
export const ACCEPT_RANGE: [number, number] = [0.1, 0.6];

/** Splits each chain in half (dropping a middle draw if the length is odd), so drifting chains look like disagreeing chains. */
function splitChains(chains: ArrayLike<number>[]): ArrayLike<number>[] {
  const out: ArrayLike<number>[] = [];
  for (const c of chains) {
    const half = Math.floor(c.length / 2);
    const arr = Array.from(c);
    out.push(arr.slice(0, half), arr.slice(c.length - half));
  }
  return out;
}

/** Mean and unbiased variance of an array. */
function meanVar(x: ArrayLike<number>): { mean: number; variance: number } {
  const n = x.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i] as number;
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += ((x[i] as number) - mean) ** 2;
  return { mean, variance: n > 1 ? ss / (n - 1) : 0 };
}

/** Split R-hat (Gelman-Rubin on half-chains): sqrt(var+ / W). Values near 1 mean the chains agree. */
export function splitRhat(chains: ArrayLike<number>[]): number {
  const parts = splitChains(chains);
  const m = parts.length;
  const n = parts[0]?.length ?? 0;
  if (m < 2 || n < 2) return NaN;
  const stats = parts.map(meanVar);
  const W = stats.reduce((a, s) => a + s.variance, 0) / m;
  const grand = stats.reduce((a, s) => a + s.mean, 0) / m;
  const B = (n / (m - 1)) * stats.reduce((a, s) => a + (s.mean - grand) ** 2, 0);
  const varPlus = ((n - 1) / n) * W + B / n;
  if (W === 0) return B === 0 ? 1 : Infinity;
  return Math.sqrt(varPlus / W);
}

/** Effective sample size over all chains (Geyer's initial monotone positive-pair estimator on split chains, as in Stan). */
export function effectiveSampleSize(chains: ArrayLike<number>[]): number {
  const parts = splitChains(chains);
  const m = parts.length;
  const n = parts[0]?.length ?? 0;
  if (m < 2 || n < 4) return NaN;
  const stats = parts.map(meanVar);
  const W = stats.reduce((a, s) => a + s.variance, 0) / m;
  const grand = stats.reduce((a, s) => a + s.mean, 0) / m;
  const B = (n / (m - 1)) * stats.reduce((a, s) => a + (s.mean - grand) ** 2, 0);
  const varPlus = ((n - 1) / n) * W + B / n;
  if (varPlus === 0) return m * n;
  const maxLag = Math.min(n - 1, 1000);
  const rho = new Array<number>(maxLag + 1).fill(0);
  for (let t = 0; t <= maxLag; t++) {
    let meanAcov = 0;
    parts.forEach((c, j) => {
      const mu = (stats[j] as { mean: number }).mean;
      let s = 0;
      for (let i = 0; i + t < n; i++) s += ((c[i] as number) - mu) * ((c[i + t] as number) - mu);
      meanAcov += s / n;
    });
    meanAcov /= m;
    rho[t] = 1 - (W - meanAcov) / varPlus;
  }
  // Sum autocorrelation in pairs while the pair sum stays positive (and monotone non-increasing).
  let tau = -1;
  let prevPair = Infinity;
  for (let k = 0; 2 * k + 1 <= maxLag; k++) {
    let pair = (rho[2 * k] as number) + (rho[2 * k + 1] as number);
    if (pair <= 0) break;
    pair = Math.min(pair, prevPair);
    prevPair = pair;
    tau += 2 * pair;
  }
  return (m * n) / Math.max(tau, 1 / Math.log10(m * n)); // floor on tau keeps ESS from exceeding ~N log10 N (antithetic chains)
}

export interface ParamSummary {
  mean: number;
  sd: number;
  q025: number;
  q25: number;
  median: number;
  q75: number;
  q975: number;
}

/** Posterior summary of pooled draws. */
export function summarize(chains: ArrayLike<number>[]): ParamSummary {
  const all = Float64Array.from(chains.flatMap((c) => Array.from(c))).sort();
  const { mean, variance } = meanVar(all);
  return {
    mean,
    sd: Math.sqrt(variance),
    q025: quantileSorted(all, 0.025),
    q25: quantileSorted(all, 0.25),
    median: quantileSorted(all, 0.5),
    q75: quantileSorted(all, 0.75),
    q975: quantileSorted(all, 0.975),
  };
}

export interface ParamDiagnostics {
  name: string;
  rhat: number;
  ess: number;
}

export interface Verdict {
  converged: boolean;
  reasons: string[];
  warnings: string[];
}

/** Applies the stated thresholds (R-hat < 1.05 and ESS >= 200 for every parameter) and explains any failure in plain words. */
export function convergenceVerdict(params: ParamDiagnostics[], acceptRates: number[]): Verdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  for (const p of params) {
    if (!(p.rhat < RHAT_MAX))
      reasons.push(
        `${p.name}: R-hat is ${Number.isFinite(p.rhat) ? p.rhat.toFixed(3) : 'undefined'} (needs to be below ${RHAT_MAX}); the chains disagree with each other.`,
      );
    if (!(p.ess >= ESS_MIN))
      reasons.push(
        `${p.name}: effective sample size is ${Number.isFinite(p.ess) ? Math.round(p.ess) : 'undefined'} (needs at least ${ESS_MIN}); too few independent draws.`,
      );
  }
  for (const a of acceptRates) {
    if (!(a >= ACCEPT_RANGE[0] && a <= ACCEPT_RANGE[1])) {
      warnings.push(
        `A chain accepted ${(a * 100).toFixed(0)}% of proposals (healthy range ${ACCEPT_RANGE[0] * 100}–${ACCEPT_RANGE[1] * 100}%); the sampler may be moving inefficiently.`,
      );
      break;
    }
  }
  return { converged: reasons.length === 0, reasons, warnings };
}

/** Pearson correlation of two equal-length arrays. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ma = meanVar(a);
  const mb = meanVar(b);
  let s = 0;
  for (let i = 0; i < a.length; i++)
    s += ((a[i] as number) - ma.mean) * ((b[i] as number) - mb.mean);
  return s / ((a.length - 1) * Math.sqrt(ma.variance * mb.variance));
}

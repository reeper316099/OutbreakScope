// Fitting model: parameter space (transformed so every parameter stays in its valid range), priors, the
// likelihood of an observed series, synthetic-data generation, posterior predictive bands, goodness of fit
// and identifiability warnings.
//
// Observation model (MODEL.md section 7): expected reported cases in an interval = rho x onsets in that interval,
// shifted back in time by a fixed reporting delay. Reported cases are NOT infections.
import type { ModelKind, ObservedSeries } from '../shared/types';
import { correlation } from './diagnostics';
import { NumericalError } from './errors';
import { cholesky } from './mcmc';
import { integrate } from './rk4';
import { countVariance, logLikelihood } from './likelihood';
import type { LikelihoodKind } from './likelihood';
import { MAX_RATE_PER_DAY } from './params';
import { Rng } from './rng';
import { invLogit, logBeta, logit, trigamma } from './special';
import { quantileSorted } from './stochastic';

export type FitParamName = 'r0' | 'i0' | 'rho' | 'dispersion' | 'incubation' | 'infectious';

export interface LogNormalPrior {
  /** Median of the prior (the prior is lognormal: ln x is normal with mean ln(median)). */
  median: number;
  /** Standard deviation of ln x ("spread"; 0.5 means roughly a factor of 1.65 per standard deviation). */
  sigmaLog: number;
}

export interface BetaPrior {
  a: number;
  b: number;
}

export interface FitPriors {
  r0: LogNormalPrior;
  i0: LogNormalPrior;
  rho: BetaPrior;
  dispersion: LogNormalPrior;
  incubation: LogNormalPrior;
  infectious: LogNormalPrior;
}

export const DEFAULT_PRIORS: FitPriors = {
  r0: { median: 2, sigmaLog: 0.6 },
  i0: { median: 10, sigmaLog: 1.5 },
  rho: { a: 1, b: 1 },
  dispersion: { median: 10, sigmaLog: 1 },
  incubation: { median: 3, sigmaLog: 0.3 },
  infectious: { median: 5, sigmaLog: 0.3 },
};

export interface FitConfig {
  model: Extract<ModelKind, 'SIR' | 'SEIR'>;
  population: number;
  /** Values of parameters that are NOT fitted, and starting values for the ones that are. */
  values: {
    r0: number;
    i0: number;
    rho: number;
    dispersion: number;
    incubationDays: number;
    infectiousDays: number;
  };
  /** Parameters estimated from data; r0 is always included. */
  fitted: FitParamName[];
  likelihood: LikelihoodKind;
  /** Fixed reporting delay in whole days (0-14). */
  reportingDelayDays: number;
  priors: FitPriors;
}

export interface ParamDef {
  name: FitParamName;
  label: string;
  transform: 'log' | 'logit';
  prior: LogNormalPrior | BetaPrior;
  /** Natural-scale bounds (used for boundary warnings). */
  lower: number;
  upper: number;
}

export interface NaturalParams {
  r0: number;
  i0: number;
  rho: number;
  dispersion: number;
  incubationDays: number;
  infectiousDays: number;
}

const LABELS: Record<FitParamName, string> = {
  r0: 'R0',
  i0: 'Initially infectious (I0)',
  rho: 'Reporting fraction (rho)',
  dispersion: 'Dispersion (k)',
  incubation: 'Incubation period (days)',
  infectious: 'Infectious period (days)',
};

/** The fitted parameters, in a fixed order, with their transforms and priors. */
export function paramSpace(config: FitConfig): ParamDef[] {
  const order: FitParamName[] = ['r0', 'i0', 'rho', 'dispersion', 'incubation', 'infectious'];
  return order
    .filter((n) => n === 'r0' || config.fitted.includes(n))
    .filter((n) =>
      n === 'dispersion'
        ? config.likelihood === 'negbin'
        : n === 'incubation'
          ? config.model === 'SEIR'
          : true,
    )
    .map((name) => ({
      name,
      label: LABELS[name],
      transform: name === 'rho' ? ('logit' as const) : ('log' as const),
      prior: config.priors[name],
      lower: name === 'rho' ? 0 : name === 'r0' ? 0 : 0,
      upper: name === 'rho' ? 1 : name === 'r0' ? 50 : name === 'i0' ? config.population : 365,
    }));
}

/** Maps an unbounded value u to the parameter's natural scale. */
export function toNaturalValue(def: ParamDef, u: number): number {
  return def.transform === 'log' ? Math.exp(u) : invLogit(u);
}

/** Maps a natural value to the unbounded scale. */
export function toUnbounded(def: ParamDef, x: number): number {
  return def.transform === 'log' ? Math.log(x) : logit(x);
}

/** Full natural parameter set for a vector u of the fitted parameters (others come from config.values). */
export function naturalFromU(
  config: FitConfig,
  defs: ParamDef[],
  u: ArrayLike<number>,
): NaturalParams {
  const v: NaturalParams = { ...config.values };
  defs.forEach((d, i) => {
    const x = toNaturalValue(d, u[i] as number);
    if (d.name === 'r0') v.r0 = x;
    else if (d.name === 'i0') v.i0 = x;
    else if (d.name === 'rho') v.rho = x;
    else if (d.name === 'dispersion') v.dispersion = x;
    else if (d.name === 'incubation') v.incubationDays = x;
    else v.infectiousDays = x;
  });
  return v;
}

/** Log prior density of a parameter in its UNBOUNDED coordinate u (includes the change-of-variables Jacobian). */
export function logPriorU(def: ParamDef, u: number): number {
  if (def.transform === 'log') {
    const p = def.prior as LogNormalPrior;
    const z = (u - Math.log(p.median)) / p.sigmaLog;
    return -0.5 * z * z - Math.log(p.sigmaLog) - 0.5 * Math.log(2 * Math.PI);
  }
  const p = def.prior as BetaPrior;
  const rho = invLogit(u);
  // Beta density times |d rho / du| = rho (1 - rho):  rho^a (1 - rho)^b / B(a, b)
  return p.a * Math.log(rho) + p.b * Math.log(1 - rho) - logBeta(p.a, p.b);
}

/** Standard deviation of the prior in the unbounded coordinate (for the "did the data teach us anything?" check). */
export function priorSdU(def: ParamDef): number {
  if (def.transform === 'log') return (def.prior as LogNormalPrior).sigmaLog;
  const p = def.prior as BetaPrior;
  return Math.sqrt(trigamma(p.a) + trigamma(p.b)); // variance of logit(Beta(a, b))
}

/** Draws a prior sample of u. */
export function samplePriorU(def: ParamDef, rng: Rng): number {
  if (def.transform === 'log') {
    const p = def.prior as LogNormalPrior;
    return Math.log(p.median) + p.sigmaLog * rng.normal();
  }
  const p = def.prior as BetaPrior;
  const ga = rng.gamma(p.a);
  const gb = rng.gamma(p.b);
  return logit(Math.min(1 - 1e-9, Math.max(1e-9, ga / (ga + gb))));
}

export interface Interval {
  startDay: number;
  endDay: number;
}

/**
 * Expected reported cases for arbitrary intervals: mu = rho * (onsets in the interval, delayed by reportingDelayDays).
 * Returns null if the parameters are invalid or too stiff (the caller treats that as probability zero).
 */
export function expectedCounts(
  config: FitConfig,
  p: NaturalParams,
  intervals: Interval[],
): Float64Array | null {
  const N = config.population;
  const gamma = 1 / p.infectiousDays;
  const sigma = config.model === 'SEIR' ? 1 / p.incubationDays : null;
  const beta = p.r0 * gamma;
  const ok =
    [p.r0, p.i0, p.rho, p.infectiousDays, p.incubationDays].every(Number.isFinite) &&
    p.r0 > 0 &&
    p.r0 <= 50 &&
    p.i0 >= 1e-3 &&
    p.i0 <= N &&
    p.rho > 0 &&
    p.rho <= 1 &&
    p.infectiousDays >= 0.05 &&
    p.infectiousDays <= 365 &&
    p.incubationDays >= 0.05 &&
    p.incubationDays <= 365 &&
    Math.max(beta, gamma, sigma ?? 0) <= MAX_RATE_PER_DAY;
  if (!ok) return null;
  const d = config.reportingDelayDays;
  const edgeSet = new Set<number>([0]);
  for (const iv of intervals) {
    edgeSet.add(Math.max(0, iv.startDay - d));
    edgeSet.add(Math.max(0, iv.endDay - d));
  }
  const edges = [...edgeSet].sort((a, b) => a - b);
  const horizon = edges[edges.length - 1] as number;
  const out = new Float64Array(intervals.length);
  if (horizon <= 0) return out;
  let cum: Float64Array;
  try {
    cum = integrate({
      model: config.model,
      rates: { betaPerDay: beta, sigmaPerDay: sigma, gammaPerDay: gamma },
      population: N,
      initialInfected: p.i0,
      vaccineEfficacy: 0,
      schedule: [{ startDay: 0, endDay: horizon, contactMultiplier: 1, vaccinationRatePerDay: 0 }],
      horizonDays: horizon,
      outputTimes: Float64Array.from(edges),
    }).trajectory.cumOnsets;
  } catch (e) {
    if (e instanceof NumericalError) return null;
    throw e;
  }
  const index = new Map<number, number>(edges.map((e, i) => [e, i]));
  intervals.forEach((iv, k) => {
    const a = cum[index.get(Math.max(0, iv.startDay - d)) as number] as number; // edges were built from these exact values
    const b = cum[index.get(Math.max(0, iv.endDay - d)) as number] as number;
    out[k] = p.rho * Math.max(0, b - a);
  });
  return out;
}

/** The intervals covered by each observation of a series. */
export function seriesIntervals(series: ObservedSeries): Interval[] {
  return series.endDays.map((e) => ({ startDay: e - series.intervalDays, endDay: e }));
}

export interface FitEvaluator {
  defs: ParamDef[];
  config: FitConfig;
  series: ObservedSeries;
  natural: (u: ArrayLike<number>) => NaturalParams;
  logPrior: (u: ArrayLike<number>) => number;
  logLik: (u: ArrayLike<number>) => number;
  logPosterior: (u: number[]) => number;
}

/** Builds the log-posterior for a configuration and an observed series. */
export function makeEvaluator(config: FitConfig, series: ObservedSeries): FitEvaluator {
  const defs = paramSpace(config);
  const intervals = seriesIntervals(series);
  const natural = (u: ArrayLike<number>): NaturalParams => naturalFromU(config, defs, u);
  const logPrior = (u: ArrayLike<number>): number =>
    defs.reduce((acc, d, i) => acc + logPriorU(d, u[i] as number), 0);
  const logLik = (u: ArrayLike<number>): number => {
    const p = natural(u);
    const mu = expectedCounts(config, p, intervals);
    if (mu === null) return -Infinity;
    return logLikelihood(config.likelihood, series.counts, mu, p.dispersion);
  };
  const logPosterior = (u: number[]): number => {
    for (const x of u) if (!Number.isFinite(x) || Math.abs(x) > 40) return -Infinity;
    const lp = logPrior(u);
    if (!Number.isFinite(lp)) return -Infinity;
    const ll = logLik(u);
    return Number.isFinite(ll) ? lp + ll : -Infinity;
  };
  return { defs, config, series, natural, logPrior, logLik, logPosterior };
}

/** Starting points for the optimiser: the configured values first, then random draws from the prior. */
export function startingPoints(ev: FitEvaluator, count: number, seed: number): number[][] {
  const rng = Rng.forStream(seed, 7_000_000);
  const base = ev.defs.map((d) => {
    const x =
      d.name === 'r0'
        ? ev.config.values.r0
        : d.name === 'i0'
          ? ev.config.values.i0
          : d.name === 'rho'
            ? ev.config.values.rho
            : d.name === 'dispersion'
              ? ev.config.values.dispersion
              : d.name === 'incubation'
                ? ev.config.values.incubationDays
                : ev.config.values.infectiousDays;
    return toUnbounded(d, x);
  });
  const starts: number[][] = [base];
  let guard = 0;
  while (starts.length < count && guard++ < count * 50) {
    const u = ev.defs.map((d) => samplePriorU(d, rng));
    if (Number.isFinite(ev.logPosterior(u))) starts.push(u);
  }
  return starts;
}

/**
 * Over-dispersed starting point for MCMC chain c: the mode for chain 0; for the others, the mode plus a draw from a normal with
 * 2x the approximate posterior spread (covariance from the curvature at the mode), shrunk until the point is valid.
 */
export function chainStart(
  ev: FitEvaluator,
  map: number[],
  chainIndex: number,
  seed: number,
  cov?: number[][],
): number[] {
  if (chainIndex === 0) return [...map];
  const rng = Rng.forStream(seed, 8_000_000 + chainIndex);
  const d = map.length;
  const l = cov ? cholesky(cov) : null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const shrink = 2 * Math.pow(0.85, attempt);
    const z = Array.from({ length: d }, () => rng.normal());
    const u = map.map((m, i) => {
      if (l === null)
        return m + shrink * 0.25 * Math.min(1, priorSdU(ev.defs[i] as ParamDef)) * (z[i] as number);
      let step = 0;
      for (let k = 0; k <= i; k++) step += ((l[i] as number[])[k] as number) * (z[k] as number);
      return m + shrink * step;
    });
    if (Number.isFinite(ev.logPosterior(u))) return u;
  }
  return [...map];
}

// ---- synthetic data

export interface SyntheticSpec {
  config: FitConfig;
  truth: NaturalParams;
  intervalDays: 1 | 7;
  observations: number;
  seed: number;
  label?: string;
}

/** Simulates reported counts from the model with Poisson (or negative-binomial) noise drawn from the seeded PRNG. */
export function generateSynthetic(spec: SyntheticSpec): ObservedSeries {
  const endDays = Array.from({ length: spec.observations }, (_, i) => (i + 1) * spec.intervalDays);
  const mu = expectedCounts(
    spec.config,
    spec.truth,
    endDays.map((e) => ({ startDay: e - spec.intervalDays, endDay: e })),
  );
  if (mu === null) throw new NumericalError('The true parameters are not valid for simulation.');
  const rng = Rng.forStream(spec.seed, 9_000_000);
  const counts = Array.from(mu, (m) =>
    spec.config.likelihood === 'negbin'
      ? rng.negativeBinomial(m, spec.truth.dispersion)
      : rng.poisson(m),
  );
  return {
    label: spec.label ?? 'Synthetic data',
    counts,
    endDays,
    intervalDays: spec.intervalDays,
    dates: null,
  };
}

// ---- posterior predictive, goodness of fit

export interface Band {
  q025: number[];
  q25: number[];
  median: number[];
  q75: number[];
  q975: number[];
}

export interface Predictive {
  /** Bands for the expected counts (uncertainty in parameters only). */
  expected: Band;
  /** Bands for new observed counts (parameters + observation noise). */
  observed: Band;
  /** Intervals the bands refer to. */
  intervals: Interval[];
  draws: number;
}

/** Computes a band from per-draw values (draws x intervals). */
function bandOf(values: Float64Array[], k: number): Band {
  const out: Band = { q025: [], q25: [], median: [], q75: [], q975: [] };
  const col = new Float64Array(values.length);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < values.length; i++) col[i] = (values[i] as Float64Array)[j] as number;
    col.sort();
    out.q025.push(quantileSorted(col, 0.025));
    out.q25.push(quantileSorted(col, 0.25));
    out.median.push(quantileSorted(col, 0.5));
    out.q75.push(quantileSorted(col, 0.75));
    out.q975.push(quantileSorted(col, 0.975));
  }
  return out;
}

/** Posterior predictive bands over the given intervals using (up to) `maxDraws` evenly spaced posterior draws. */
export function posteriorPredictive(
  ev: FitEvaluator,
  draws: number[][],
  intervals: Interval[],
  seed: number,
  maxDraws = 400,
): Predictive {
  const step = Math.max(1, Math.floor(draws.length / maxDraws));
  const rng = Rng.forStream(seed, 9_500_000);
  const expected: Float64Array[] = [];
  const observed: Float64Array[] = [];
  for (let i = 0; i < draws.length; i += step) {
    const u = draws[i] as number[];
    const p = ev.natural(u);
    const mu = expectedCounts(ev.config, p, intervals);
    if (mu === null) continue;
    expected.push(mu);
    observed.push(
      Float64Array.from(mu, (m) =>
        ev.config.likelihood === 'negbin' ? rng.negativeBinomial(m, p.dispersion) : rng.poisson(m),
      ),
    );
  }
  return {
    expected: bandOf(expected, intervals.length),
    observed: bandOf(observed, intervals.length),
    intervals,
    draws: expected.length,
  };
}

export interface GoodnessOfFit {
  rmse: number;
  mae: number;
  /** 1 - SSE/SST: share of variation in the counts explained (can be negative). */
  r2: number;
  /** Share of observations inside the 50% and 95% predictive bands (a well-calibrated model gives about 50% and 95%). */
  coverage50: number;
  coverage95: number;
  /** Standardised residuals (y - mu) / sd under the fitted likelihood. */
  residuals: number[];
  /** Pearson chi-square divided by the number of observations (about 1 for a good Poisson fit). */
  pearsonPerObservation: number;
}

/** Simple goodness-of-fit summary of observed counts against the posterior-median expected curve and predictive bands. */
export function goodnessOfFit(
  series: ObservedSeries,
  pred: Predictive,
  kind: LikelihoodKind,
  dispersion: number,
): GoodnessOfFit {
  const y = series.counts;
  const n = y.length;
  const mu = pred.expected.median.slice(0, n);
  let sse = 0,
    sae = 0,
    chi = 0,
    mean = 0;
  for (const v of y) mean += v / n;
  const residuals: number[] = [];
  let sst = 0,
    in50 = 0,
    in95 = 0;
  for (let i = 0; i < n; i++) {
    const yi = y[i] as number,
      mi = mu[i] as number;
    sse += (yi - mi) ** 2;
    sae += Math.abs(yi - mi);
    sst += (yi - mean) ** 2;
    const v = Math.max(countVariance(kind, mi, dispersion), 1e-9);
    residuals.push((yi - mi) / Math.sqrt(v));
    chi += (yi - mi) ** 2 / v;
    if (yi >= (pred.observed.q25[i] as number) && yi <= (pred.observed.q75[i] as number)) in50++;
    if (yi >= (pred.observed.q025[i] as number) && yi <= (pred.observed.q975[i] as number)) in95++;
  }
  return {
    rmse: Math.sqrt(sse / n),
    mae: sae / n,
    r2: sst > 0 ? 1 - sse / sst : NaN,
    coverage50: in50 / n,
    coverage95: in95 / n,
    residuals,
    pearsonPerObservation: chi / n,
  };
}

// ---- identifiability

export interface IdentifiabilityWarning {
  kind: 'correlation' | 'prior-dominated' | 'boundary' | 'wide';
  params: FitParamName[];
  message: string;
}

export const CORRELATION_WARN = 0.8;
export const PRIOR_RATIO_WARN = 0.8;

/** Plain-language warnings about parameters the data cannot pin down (uses posterior draws in the unbounded coordinates). */
export function identifiabilityWarnings(
  defs: ParamDef[],
  draws: number[][],
): IdentifiabilityWarning[] {
  const out: IdentifiabilityWarning[] = [];
  const cols = defs.map((_, j) => Float64Array.from(draws, (d) => d[j] as number));
  for (let a = 0; a < defs.length; a++) {
    for (let b = a + 1; b < defs.length; b++) {
      const r = correlation(cols[a] as Float64Array, cols[b] as Float64Array);
      if (Math.abs(r) >= CORRELATION_WARN) {
        const da = defs[a] as ParamDef,
          db = defs[b] as ParamDef;
        out.push({
          kind: 'correlation',
          params: [da.name, db.name],
          message: `${da.label} and ${db.label} are strongly linked in the posterior (correlation ${r.toFixed(2)}): many different combinations explain the data about equally well, so each one on its own is poorly determined${(da.name === 'r0' && db.name === 'rho') || (da.name === 'rho' && db.name === 'r0') ? ' (a faster-growing outbreak with fewer cases reported looks like a slower one with more reported)' : ''}. Fixing one of them from outside knowledge makes the other meaningful.`,
        });
      }
    }
  }
  defs.forEach((d, j) => {
    const col = cols[j] as Float64Array;
    const mean = col.reduce((s, v) => s + v, 0) / col.length;
    const sd = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / (col.length - 1));
    const ratio = sd / priorSdU(d);
    if (ratio >= PRIOR_RATIO_WARN) {
      out.push({
        kind: 'prior-dominated',
        params: [d.name],
        message: `${d.label}: the posterior is almost as wide as the prior (${(ratio * 100).toFixed(0)}% of its spread), so the data taught us little about it; the result mostly reflects the prior you chose.`,
      });
    }
    const natural = Float64Array.from(col, (u) => toNaturalValue(d, u)).sort();
    const lo = quantileSorted(natural, 0.025),
      hi = quantileSorted(natural, 0.975);
    if (d.name === 'rho' && quantileSorted(natural, 0.5) > 0.9) {
      out.push({
        kind: 'boundary',
        params: ['rho'],
        message:
          'The reporting fraction piles up near 100% (the upper limit): the model wants more reported cases than it can produce, so it may be missing something (for example a larger outbreak, other dynamics, or a population that is too small).',
      });
    }
    if (d.name === 'r0' && hi > 45)
      out.push({
        kind: 'boundary',
        params: ['r0'],
        message:
          'R0 is hitting its upper limit (50); the data are not consistent with this model at plausible values.',
      });
    if (
      d.transform === 'log' &&
      lo > 0 &&
      hi / lo > 10 &&
      !out.some((w) => w.kind === 'prior-dominated' && w.params[0] === d.name)
    ) {
      out.push({
        kind: 'wide',
        params: [d.name],
        message: `${d.label}: the 95% range spans more than a factor of 10 (${lo.toPrecision(2)} to ${hi.toPrecision(2)}), so it is very poorly determined.`,
      });
    }
  });
  return out;
}

/** Sensible starting configuration for a data series (all values are editable in the UI; none are claims about the disease). */
export function suggestConfig(
  series: ObservedSeries,
  opts: {
    model?: FitConfig['model'];
    population?: number;
    incubationDays?: number;
    infectiousDays?: number;
  } = {},
): FitConfig {
  const N = opts.population ?? 1_000_000;
  const total = series.counts.reduce((a, b) => a + b, 0);
  const rho0 = Math.min(0.9, Math.max(1e-4, total / (0.4 * N))); // so that an outbreak infecting ~40% of N would produce about the observed total
  const firstPositive = series.counts.find((c) => c > 0) ?? 1;
  const i0 = Math.min(N / 10, Math.max(1, firstPositive / (rho0 * series.intervalDays)));
  return {
    model: opts.model ?? 'SEIR',
    population: N,
    values: {
      r0: 1.8,
      i0,
      rho: rho0,
      dispersion: 10,
      incubationDays: opts.incubationDays ?? 3,
      infectiousDays: opts.infectiousDays ?? 5,
    },
    fitted: ['r0', 'i0', 'rho'],
    likelihood: 'poisson',
    reportingDelayDays: 0,
    priors: { ...DEFAULT_PRIORS, i0: { median: i0, sigmaLog: 2 } },
  };
}

/** Plain-language warnings when the fitted model clearly does not match the data (so its intervals should not be trusted). */
export function misfitWarnings(gof: GoodnessOfFit, kind: LikelihoodKind): string[] {
  const out: string[] = [];
  if (gof.coverage95 < 0.8) {
    out.push(
      `Only ${(gof.coverage95 * 100).toFixed(0)}% of the observations fall inside the model's own 95% band (it should be about 95%). The model shape or noise assumption does not match the data, so the intervals on this page are too narrow: they describe uncertainty only if the model were right.`,
    );
  }
  if (gof.pearsonPerObservation > 2) {
    out.push(
      `The data scatter about ${gof.pearsonPerObservation.toFixed(1)} times more than the model allows (chi-square per observation; about 1 is expected).${kind === 'poisson' ? ' Try the negative-binomial likelihood, which allows extra scatter.' : ''}`,
    );
  }
  if (Number.isFinite(gof.r2) && gof.r2 < 0.5)
    out.push(
      `The fitted curve explains only ${(gof.r2 * 100).toFixed(0)}% of the variation in the counts.`,
    );
  return out;
}

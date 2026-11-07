// Assembles optimiser + chains into one fit result (used by the UI after the workers finish, and by tests, which run it sequentially).
import type { ObservedSeries } from '../shared/types';
import { convergenceVerdict, effectiveSampleSize, splitRhat, summarize } from './diagnostics';
import type { ParamDiagnostics, ParamSummary, Verdict } from './diagnostics';
import {
  chainStart,
  identifiabilityWarnings,
  makeEvaluator,
  naturalFromU,
  startingPoints,
  toNaturalValue,
} from './fit';
import type {
  FitConfig,
  FitEvaluator,
  IdentifiabilityWarning,
  NaturalParams,
  ParamDef,
} from './fit';
import { column, covarianceAtMode, runChain } from './mcmc';
import type { ChainResult } from './mcmc';
import { multiStart } from './optimize';
import type { MultiStartResult } from './optimize';

export interface FitRunOptions {
  seed: number;
  restarts: number;
  chains: number;
  burnIn: number;
  iterations: number;
  thin: number;
}

export const DEFAULT_RUN: FitRunOptions = {
  seed: 12345,
  restarts: 6,
  chains: 4,
  burnIn: 2000,
  iterations: 4000,
  thin: 4,
};

export interface FitResult {
  defs: ParamDef[];
  config: FitConfig;
  /** Posterior mode in unbounded coordinates. */
  map: number[];
  optim: MultiStartResult;
  chains: ChainResult[];
  diagnostics: ParamDiagnostics[];
  verdict: Verdict;
  acceptRates: number[];
  /** Pooled posterior draws (unbounded coordinates). */
  draws: number[][];
  /** Natural-scale summary per parameter (median and central 95% interval; mean/sd on the natural scale). */
  summaries: ParamSummary[];
  warnings: IdentifiabilityWarning[];
}

/** Stage 1: posterior mode by multi-start Nelder-Mead on the negative log posterior. */
export function optimizeFit(
  ev: FitEvaluator,
  opts: FitRunOptions,
  onProgress?: (done: number, total: number) => void,
): MultiStartResult {
  const starts = startingPoints(ev, opts.restarts, opts.seed);
  return multiStart(
    (u) => -ev.logPosterior(u),
    starts,
    { maxIterations: 1500, initialStep: 0.3, xTolerance: 1e-6, fTolerance: 1e-8 },
    onProgress,
  );
}

/** Stage 2 (one chain): Metropolis started over-dispersed around the mode, with a proposal shaped by the curvature there. */
export function sampleChain(
  ev: FitEvaluator,
  map: number[],
  chainIndex: number,
  opts: FitRunOptions,
  onProgress?: (done: number, total: number) => void,
): ChainResult {
  const negLogPost = (u: number[]): number => -ev.logPosterior(u);
  const cov = covarianceAtMode(negLogPost, map);
  return runChain({
    logPosterior: ev.logPosterior,
    start: chainStart(ev, map, chainIndex, opts.seed, cov),
    iterations: opts.iterations,
    burnIn: opts.burnIn,
    initialSd: ev.defs.map(() => 0.05),
    initialCov: cov,
    thin: opts.thin,
    seed: opts.seed,
    chainIndex,
    onProgress,
  });
}

/** Stage 3: diagnostics, natural-scale summaries and identifiability warnings from finished chains. */
export function assembleFit(
  ev: FitEvaluator,
  optim: MultiStartResult,
  chains: ChainResult[],
): FitResult {
  const defs = ev.defs;
  const cols = defs.map((_, j) => chains.map((c) => column(c, j)));
  const diagnostics = defs.map((d, j) => ({
    name: d.label,
    rhat: splitRhat(cols[j] as Float64Array[]),
    ess: effectiveSampleSize(cols[j] as Float64Array[]),
  }));
  const acceptRates = chains.map((c) => c.acceptRatePost);
  const draws: number[][] = [];
  for (const c of chains)
    for (let r = 0; r < c.logPosterior.length; r++)
      draws.push(Array.from(c.samples.subarray(r * c.dim, (r + 1) * c.dim)));
  const summaries = defs.map((d, j) => {
    const natural = (cols[j] as Float64Array[]).map((col) =>
      Float64Array.from(col, (u) => toNaturalValue(d, u)),
    );
    return summarize(natural);
  });
  return {
    defs,
    config: ev.config,
    map: optim.best.x,
    optim,
    chains,
    diagnostics,
    verdict: convergenceVerdict(diagnostics, acceptRates),
    acceptRates,
    draws,
    summaries,
    warnings: identifiabilityWarnings(defs, draws),
  };
}

/** Whole fit, sequentially (tests and scripts; the app runs the same stages in workers). */
export function fitSeries(
  config: FitConfig,
  series: ObservedSeries,
  opts: FitRunOptions = DEFAULT_RUN,
): FitResult {
  const ev = makeEvaluator(config, series);
  const optim = optimizeFit(ev, opts);
  const chains = Array.from({ length: opts.chains }, (_, i) =>
    sampleChain(ev, optim.best.x, i, opts),
  );
  return assembleFit(ev, optim, chains);
}

/** Natural parameters at the posterior mode. */
export function modeParams(result: FitResult): NaturalParams {
  return naturalFromU(result.config, result.defs, result.map);
}

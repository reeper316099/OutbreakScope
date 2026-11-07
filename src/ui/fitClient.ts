// Runs a fit in workers: stage 1 (optimiser, one worker), then stage 2 (one worker per chain, in parallel). Cancel terminates all.
import type { FitWorkerResponse, ObservedSeries } from '../shared/types';
import type { FitConfig } from '../sim/fit';
import type { ChainResult } from '../sim/mcmc';
import type { MultiStartResult } from '../sim/optimize';
import type { FitRunOptions } from '../sim/fitRun';

export type FitOutcome =
  | { status: 'done'; optim: MultiStartResult; chains: ChainResult[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface FitJob {
  result: Promise<FitOutcome>;
  cancel: () => void;
}

/** Starts the two-stage fit; onProgress receives (overall fraction 0-1, stage description). */
export function startFit(
  config: FitConfig,
  series: ObservedSeries,
  options: FitRunOptions,
  onProgress: (fraction: number, stage: string) => void,
): FitJob {
  const workers: Worker[] = [];
  let settled = false;
  let resolveOutcome: (o: FitOutcome) => void = () => undefined;
  const result = new Promise<FitOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  /** Settles once and terminates every worker. */
  const settle = (o: FitOutcome): void => {
    if (settled) return;
    settled = true;
    for (const w of workers) w.terminate();
    resolveOutcome(o);
  };
  const spawn = (kind: 'fit' | 'mcmc'): Worker => {
    const w =
      kind === 'fit'
        ? new Worker(new URL('../workers/fit.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('../workers/mcmc.worker.ts', import.meta.url), { type: 'module' });
    workers.push(w);
    w.onerror = (e): void => settle({ status: 'error', message: e.message || 'A worker failed.' });
    return w;
  };

  const optimizer = spawn('fit');
  optimizer.onmessage = (event: MessageEvent<FitWorkerResponse>): void => {
    const msg = event.data;
    if (msg.type === 'progress')
      onProgress(0.1 * (msg.done / msg.total), 'Step 1 of 2: finding the best-fitting values');
    else if (msg.type === 'error') settle({ status: 'error', message: msg.message });
    else if (msg.type === 'optimized') {
      optimizer.terminate();
      runChains(msg.result);
    }
  };
  optimizer.postMessage({ type: 'optimize', jobId: 1, config, series, options });

  /** Stage 2: parallel chains. */
  function runChains(optim: MultiStartResult): void {
    if (settled) return;
    const done = new Array<number>(options.chains).fill(0);
    const chains: ChainResult[] = [];
    for (let c = 0; c < options.chains; c++) {
      const w = spawn('mcmc');
      w.onmessage = (event: MessageEvent<FitWorkerResponse>): void => {
        const msg = event.data;
        if (msg.type === 'progress') {
          done[msg.chainIndex] = msg.done / msg.total;
          onProgress(
            0.1 + 0.9 * (done.reduce((a, b) => a + b, 0) / options.chains),
            `Step 2 of 2: sampling the uncertainty (${options.chains} chains in parallel)`,
          );
        } else if (msg.type === 'chain') {
          chains[msg.chainIndex] = {
            dim: msg.dim,
            samples: msg.samples,
            logPosterior: msg.logPosterior,
            acceptRateBurnIn: msg.acceptRateBurnIn,
            acceptRatePost: msg.acceptRatePost,
            adaptationIterations: msg.adaptationIterations,
          };
          if (chains.filter(Boolean).length === options.chains)
            settle({ status: 'done', optim, chains });
        } else if (msg.type === 'error') settle({ status: 'error', message: msg.message });
      };
      w.postMessage({
        type: 'chain',
        jobId: 1,
        config,
        series,
        options,
        map: optim.best.x,
        chainIndex: c,
      });
    }
  }
  return { result, cancel: () => settle({ status: 'cancelled' }) };
}

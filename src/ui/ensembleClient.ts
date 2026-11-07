// Runs stochastic realizations in several module Web Workers; reports progress and supports cancel (terminate).
import type { EnsembleWorkerResponse, Scenario } from '../shared/types';
import { emptyEnsemble, mergeChunk } from '../sim/ensemble';
import type { EnsembleData } from '../sim/ensemble';
import { uniformGrid } from '../sim/rk4';

export type EnsembleOutcome =
  | { status: 'done'; data: EnsembleData; method: 'gillespie' | 'chain_binomial' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface EnsembleJob {
  result: Promise<EnsembleOutcome>;
  cancel: () => void;
}

/** Starts a job: splits the realizations over up to 4 workers (results are identical regardless of the split). */
export function startEnsemble(
  scenario: Scenario,
  onProgress: (fraction: number) => void,
): EnsembleJob {
  const total = scenario.ensembleSize;
  const nWorkers = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2, total));
  const times = uniformGrid(scenario.params.horizonDays);
  const data = emptyEnsemble(times, total);
  const workers: Worker[] = [];
  const doneBy = new Array<number>(nWorkers).fill(0);
  let finished = 0;
  let method: 'gillespie' | 'chain_binomial' = 'gillespie';
  let settled = false;
  let resolveOutcome: (o: EnsembleOutcome) => void = () => undefined;
  const result = new Promise<EnsembleOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  /** Settles the job once and shuts every worker down. */
  const settle = (o: EnsembleOutcome): void => {
    if (settled) return;
    settled = true;
    for (const w of workers) w.terminate();
    resolveOutcome(o);
  };

  const per = Math.floor(total / nWorkers);
  const extra = total % nWorkers;
  let start = 0;
  for (let i = 0; i < nWorkers; i++) {
    const count = per + (i < extra ? 1 : 0);
    const worker = new Worker(new URL('../workers/ensemble.worker.ts', import.meta.url), {
      type: 'module',
    });
    workers.push(worker);
    const index = i;
    worker.onmessage = (event: MessageEvent<EnsembleWorkerResponse>): void => {
      const msg = event.data;
      if (msg.type === 'progress') {
        doneBy[index] = msg.done;
        onProgress(doneBy.reduce((a, b) => a + b, 0) / total);
      } else if (msg.type === 'result') {
        mergeChunk(data, msg);
        method = msg.method;
        finished++;
        if (finished === nWorkers) settle({ status: 'done', data, method });
      } else {
        settle({ status: 'error', message: msg.message });
      }
    };
    worker.onerror = (e): void =>
      settle({ status: 'error', message: e.message || 'A worker failed.' });
    worker.postMessage({ type: 'run', jobId: 1, scenario, start, count });
    start += count;
  }
  return { result, cancel: () => settle({ status: 'cancelled' }) };
}

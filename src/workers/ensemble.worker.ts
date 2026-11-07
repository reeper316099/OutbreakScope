// Stochastic ensemble worker: runs a block of realizations and reports progress; the UI cancels by terminating it.
import type { EnsembleWorkerRequest, EnsembleWorkerResponse } from '../shared/types';
import { buildSchedule } from '../sim/interventions';
import { userToInternal } from '../sim/params';
import { runRealization } from '../sim/stochastic';
import type { StochasticOptions } from '../sim/stochastic';
import { uniformGrid } from '../sim/rk4';

/** Posts a typed reply (optionally transferring big buffers). */
function post(msg: EnsembleWorkerResponse, transfer: Transferable[] = []): void {
  (
    self as unknown as { postMessage(m: EnsembleWorkerResponse, t: Transferable[]): void }
  ).postMessage(msg, transfer);
}

self.onmessage = (event: MessageEvent<EnsembleWorkerRequest>): void => {
  const req = event.data;
  try {
    const { params: p, interventions, seed } = req.scenario;
    const times = uniformGrid(p.horizonDays);
    const options: StochasticOptions = {
      model: p.model,
      rates: userToInternal(p),
      population: Math.round(p.population),
      initialInfected: Math.max(1, Math.round(p.initialInfected)),
      vaccineEfficacy: p.vaccineEfficacy,
      schedule: buildSchedule(interventions, p.horizonDays),
      horizonDays: p.horizonDays,
      seed,
      method: 'auto',
      outputTimes: times,
    };
    const m = times.length;
    const I = new Float64Array(req.count * m);
    const cum = new Float64Array(req.count * m);
    const major = new Uint8Array(req.count);
    const extinct = new Uint8Array(req.count);
    let method: 'gillespie' | 'chain_binomial' = 'gillespie';
    const reportEvery = Math.max(1, Math.floor(req.count / 50));
    for (let r = 0; r < req.count; r++) {
      const run = runRealization(options, req.start + r);
      method = run.method;
      I.set(run.I, r * m);
      cum.set(run.cumInfections, r * m);
      major[r] = run.major ? 1 : 0;
      extinct[r] = run.extinct ? 1 : 0;
      if ((r + 1) % reportEvery === 0 || r + 1 === req.count)
        post({ type: 'progress', jobId: req.jobId, done: r + 1 });
    }
    post(
      {
        type: 'result',
        jobId: req.jobId,
        start: req.start,
        count: req.count,
        times,
        I,
        cumInfections: cum,
        major,
        extinct,
        method,
      },
      [times.buffer, I.buffer, cum.buffer, major.buffer, extinct.buffer],
    );
  } catch (error) {
    post({
      type: 'error',
      jobId: req.jobId,
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
  }
};

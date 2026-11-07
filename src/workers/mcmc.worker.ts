// Fit stage 2: run one Metropolis chain. Several of these run in parallel (one per chain); cancelled by terminating the worker.
import type { FitWorkerRequest, FitWorkerResponse } from '../shared/types';
import { makeEvaluator } from '../sim/fit';
import { sampleChain } from '../sim/fitRun';

/** Posts a typed reply, transferring the big arrays. */
function post(msg: FitWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage(m: FitWorkerResponse, t: Transferable[]): void }).postMessage(
    msg,
    transfer,
  );
}

self.onmessage = (event: MessageEvent<FitWorkerRequest>): void => {
  const req = event.data;
  if (req.type !== 'chain') return;
  try {
    const ev = makeEvaluator(req.config, req.series);
    const r = sampleChain(ev, req.map, req.chainIndex, req.options, (done, total) =>
      post({
        type: 'progress',
        jobId: req.jobId,
        stage: 'chain',
        chainIndex: req.chainIndex,
        done,
        total,
      }),
    );
    post(
      {
        type: 'chain',
        jobId: req.jobId,
        chainIndex: req.chainIndex,
        dim: r.dim,
        samples: r.samples,
        logPosterior: r.logPosterior,
        acceptRateBurnIn: r.acceptRateBurnIn,
        acceptRatePost: r.acceptRatePost,
        adaptationIterations: r.adaptationIterations,
      },
      [r.samples.buffer, r.logPosterior.buffer],
    );
  } catch (error) {
    post({
      type: 'error',
      jobId: req.jobId,
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
  }
};

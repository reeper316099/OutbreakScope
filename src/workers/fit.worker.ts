// Fit stage 1: find the posterior mode with multi-start Nelder-Mead. Cancelled by the UI terminating the worker.
import type { FitWorkerRequest, FitWorkerResponse } from '../shared/types';
import { makeEvaluator } from '../sim/fit';
import { optimizeFit } from '../sim/fitRun';

/** Posts a typed reply. */
function post(msg: FitWorkerResponse): void {
  (self as unknown as { postMessage(m: FitWorkerResponse): void }).postMessage(msg);
}

self.onmessage = (event: MessageEvent<FitWorkerRequest>): void => {
  const req = event.data;
  if (req.type !== 'optimize') return;
  try {
    const ev = makeEvaluator(req.config, req.series);
    const result = optimizeFit(ev, req.options, (done, total) =>
      post({ type: 'progress', jobId: req.jobId, stage: 'optimize', chainIndex: 0, done, total }),
    );
    post({ type: 'optimized', jobId: req.jobId, result });
  } catch (error) {
    post({
      type: 'error',
      jobId: req.jobId,
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
  }
};

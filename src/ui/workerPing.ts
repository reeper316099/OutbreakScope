import type { PingResponse, TaskState } from '../shared/types';

/** Round-trips a number through the ping worker; resolves to a typed state (never throws). */
export function pingWorker(value: number): Promise<TaskState<number>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../workers/ping.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (state: TaskState<number>): void => {
      worker.terminate();
      resolve(state);
    };
    worker.onmessage = (event: MessageEvent<PingResponse>): void => {
      const msg = event.data;
      finish(
        msg.type === 'pong'
          ? { status: 'done', result: msg.value }
          : { status: 'error', message: msg.message },
      );
    };
    worker.onerror = (event): void => finish({ status: 'error', message: event.message });
    worker.postMessage({ type: 'ping', id: 1, value });
  });
}

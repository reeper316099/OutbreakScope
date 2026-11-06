// Minimal worker used by the shell to prove module workers run under the CSP; doubles the number it receives.
import type { PingRequest, PingResponse } from '../shared/types';

self.onmessage = (event: MessageEvent<PingRequest>): void => {
  const msg = event.data;
  const reply: PingResponse =
    msg.type === 'ping' && Number.isFinite(msg.value)
      ? { type: 'pong', id: msg.id, value: msg.value * 2 }
      : { type: 'error', id: msg.id, message: 'bad ping' };
  self.postMessage(reply);
};

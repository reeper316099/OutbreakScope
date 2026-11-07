// Renders the standard panel states (idle / running / done / cancelled / error / empty) from a TaskState.
import type { TaskState } from '../shared/types';
import { clear, h } from './dom';

export interface StateOptions<T> {
  idleText: string;
  /** Called to draw the finished result. */
  done: (container: HTMLElement, result: T) => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

/** Fills `container` according to the task state (progress bar + Cancel, friendly error + Retry, etc.). */
export function renderState<T>(
  container: HTMLElement,
  state: TaskState<T>,
  opts: StateOptions<T>,
): void {
  switch (state.status) {
    case 'idle':
      clear(container);
      container.append(h('p', { class: 'muted state-note', 'data-state': 'idle' }, opts.idleText));
      break;
    case 'running': {
      const pct = Math.round(state.progress * 100);
      const existing = container.querySelector<HTMLElement>('[data-state="running"]');
      if (existing) {
        // Keep the Cancel button in place while progress ticks, so it can always be clicked.
        existing.querySelector('progress')?.setAttribute('value', String(pct));
        const label = existing.querySelector('.progress-label');
        if (label) label.textContent = `${state.label ?? 'Running…'} ${pct}%`;
        break;
      }
      clear(container);
      const bar = h('progress', { max: 100, value: pct, 'aria-label': 'Progress' });
      container.append(
        h(
          'div',
          { class: 'state-note', 'data-state': 'running', role: 'status' },
          h('span', { class: 'progress-label' }, `${state.label ?? 'Running…'} ${pct}%`),
          bar,
          opts.onCancel ? cancelButton(opts.onCancel) : null,
        ),
      );
      break;
    }
    case 'cancelled':
      clear(container);
      container.append(
        h(
          'p',
          { class: 'muted state-note', 'data-state': 'cancelled' },
          'Run cancelled. Nothing was changed.',
          opts.onRetry ? retryButton(opts.onRetry, 'Run again') : null,
        ),
      );
      break;
    case 'error':
      clear(container);
      container.append(
        h(
          'div',
          { class: 'state-note error', 'data-state': 'error', role: 'alert' },
          h('p', {}, state.message),
          opts.onRetry ? retryButton(opts.onRetry, 'Retry') : null,
        ),
      );
      break;
    case 'done':
      clear(container);
      container.dataset['state'] = 'done';
      opts.done(container, state.result);
      break;
  }
}

/** A Cancel button for running tasks. */
function cancelButton(onCancel: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'btn', id: 'btn-cancel' }, 'Cancel');
  b.addEventListener('click', onCancel);
  return b;
}

/** A Retry / Run-again button. */
function retryButton(onRetry: () => void, label: string): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'btn' }, label);
  b.addEventListener('click', onRetry);
  return b;
}

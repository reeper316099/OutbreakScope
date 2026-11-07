// Diagnostics: converged / NOT converged verdict with the stated thresholds, R-hat and ESS table, acceptance rates and trace plots.
import { ACCEPT_RANGE, ESS_MIN, RHAT_MAX } from '../sim/diagnostics';
import { column } from '../sim/mcmc';
import type { FitResult } from '../sim/fitRun';
import { toNaturalValue } from '../sim/fit';
import { clear, h } from './dom';
import { drawTrace } from './fitCharts';

/** Big status banner: green "converged" or red "NOT converged" with plain-language reasons. */
export function verdictBanner(result: FitResult): HTMLElement {
  const v = result.verdict;
  if (v.converged) {
    return h(
      'div',
      { class: 'verdict ok', id: 'verdict', 'data-converged': 'true', role: 'status' },
      h('strong', {}, '✔ Converged'),
      h(
        'span',
        {},
        ` – the ${result.chains.length} independent runs agree (R-hat below ${RHAT_MAX} and at least ${ESS_MIN} effective draws for every parameter), so the numbers below can be read as this model's uncertainty.`,
      ),
    );
  }
  return h(
    'div',
    { class: 'verdict bad', id: 'verdict', 'data-converged': 'false', role: 'alert' },
    h('strong', {}, '✖ NOT converged – do not interpret these results'),
    h(
      'span',
      {},
      ' The sampler has not settled, so any intervals or curves would look more certain than they are. Try a longer run, fix some parameters, or simplify the model.',
    ),
    h('ul', {}, ...v.reasons.map((r) => h('li', {}, r))),
  );
}

/** Table of R-hat and ESS per parameter plus acceptance rates and the optimiser report. */
export function renderDiagnostics(root: HTMLElement, result: FitResult): void {
  clear(root);
  const rows = result.diagnostics.map((d) => {
    const okR = d.rhat < RHAT_MAX;
    const okE = d.ess >= ESS_MIN;
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, d.name),
      h(
        'td',
        { class: okR ? 'good' : 'bad-cell' },
        `${Number.isFinite(d.rhat) ? d.rhat.toFixed(3) : 'n/a'} ${okR ? '✔' : '✖'}`,
      ),
      h(
        'td',
        { class: okE ? 'good' : 'bad-cell' },
        `${Number.isFinite(d.ess) ? Math.round(d.ess) : 'n/a'} ${okE ? '✔' : '✖'}`,
      ),
    );
  });
  root.append(
    h(
      'p',
      { class: 'small' },
      h('strong', {}, 'R-hat'),
      ' = a check that independent sampling runs agree with each other; near 1.00 means they do (we require below ',
      String(RHAT_MAX),
      '). ',
      h('strong', {}, 'ESS'),
      ' = effective sample size, how many independent draws the correlated chain is worth (we require at least ',
      String(ESS_MIN),
      ').',
    ),
    h(
      'table',
      { class: 'data-table', id: 'diag-table' },
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, 'Parameter'), h('th', {}, 'R-hat'), h('th', {}, 'Effective draws')),
      ),
      h('tbody', {}, ...rows),
    ),
    h(
      'p',
      { class: 'small' },
      `Acceptance rates (share of proposals accepted, per chain): ${result.acceptRates.map((a) => `${(a * 100).toFixed(0)}%`).join(', ')}; healthy range ${ACCEPT_RANGE[0] * 100}–${ACCEPT_RANGE[1] * 100}%.`,
    ),
    h(
      'p',
      { class: 'small' },
      `Optimiser: ${result.optim.agreeing} of ${result.optim.all.length} restarts reached the same best value (within ${result.optim.agreeTolerance}); ${result.optim.reliable ? 'the optimum looks reliable' : 'the optimum is NOT confirmed by several restarts'}.`,
    ),
  );
  for (const w of result.verdict.warnings) root.append(h('p', { class: 'small warn' }, w));
  const traces = h('div', { class: 'trace-grid' });
  result.defs.forEach((d, j) => {
    const canvas = h('canvas', {
      class: 'mini-canvas',
      'aria-label': `Trace plot of ${d.label}`,
      role: 'img',
    });
    traces.append(canvas);
    requestAnimationFrame(() =>
      drawTrace(
        canvas,
        result.chains.map((c) => Float64Array.from(column(c, j), (u) => toNaturalValue(d, u))),
        `${d.label}: all chains`,
      ),
    );
  });
  root.append(
    h('h3', {}, 'Trace plots'),
    h(
      'p',
      { class: 'small muted' },
      'Healthy chains look like fuzzy bands that overlap and wander around the same level; chains in different places, or slow drifts, mean the run has not converged.',
    ),
    traces,
  );
}

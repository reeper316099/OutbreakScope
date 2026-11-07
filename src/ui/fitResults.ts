// Fit results: honest banners, fixed-vs-fitted table, fitted curve with predictive bands, posterior histograms with priors,
// pairwise scatter, residuals, goodness of fit, identifiability warnings and (optional) illustrative projection.
import type { ObservedSeries } from '../shared/types';
import { correlation } from '../sim/diagnostics';
import {
  goodnessOfFit,
  misfitWarnings,
  naturalFromU,
  posteriorPredictive,
  samplePriorU,
  seriesIntervals,
  toNaturalValue,
  CORRELATION_WARN,
} from '../sim/fit';
import type { FitEvaluator, GoodnessOfFit, Predictive } from '../sim/fit';
import type { FitResult } from '../sim/fitRun';
import { Rng } from '../sim/rng';
import { dataTable } from './dataTable';
import { renderDiagnostics, verdictBanner } from './diagnosticsView';
import { clear, cssVar, h } from './dom';
import { drawHistogram, drawScatter } from './fitCharts';
import { fmtSig } from './format';
import { LineChart } from './lineChart';
import type { SeriesDef } from './lineChart';

export interface FitDone {
  result: FitResult;
  ev: FitEvaluator;
  series: ObservedSeries;
  pred: Predictive;
  gof: GoodnessOfFit;
  /** Illustrative extension beyond the data (null when off). */
  projection: Predictive | null;
  seed: number;
}

/** Computes predictive bands and goodness of fit for a finished fit (the chunk of work done on the main thread after the workers). */
export function buildFitDone(
  result: FitResult,
  ev: FitEvaluator,
  series: ObservedSeries,
  seed: number,
  projectionSteps: number,
): FitDone {
  const intervals = seriesIntervals(series);
  const pred = posteriorPredictive(ev, result.draws, intervals, seed, 250);
  const mode = naturalFromU(ev.config, result.defs, result.map);
  const gof = goodnessOfFit(series, pred, ev.config.likelihood, mode.dispersion);
  return {
    result,
    ev,
    series,
    pred,
    gof,
    projection:
      projectionSteps > 0 ? buildProjection(result, ev, series, seed, projectionSteps) : null,
    seed,
  };
}

/** Bands over the data window plus `steps` more observation intervals. */
export function buildProjection(
  result: FitResult,
  ev: FitEvaluator,
  series: ObservedSeries,
  seed: number,
  steps: number,
): Predictive {
  const last = series.endDays[series.endDays.length - 1] as number;
  const extra = Array.from({ length: steps }, (_, i) => ({
    startDay: last + i * series.intervalDays,
    endDay: last + (i + 1) * series.intervalDays,
  }));
  return posteriorPredictive(
    ev,
    result.draws,
    [...seriesIntervals(series), ...extra],
    seed + 1,
    250,
  );
}

export interface ResultsHandles {
  chart: LineChart | null;
}

/** Renders everything into `root`; `showUnreliable` reveals the numbers of a non-converged fit (with a warning). */
export function renderFitResults(
  root: HTMLElement,
  done: FitDone,
  showUnreliable: boolean,
  onShowUnreliable: () => void,
  handles: ResultsHandles,
): void {
  clear(root);
  const { result } = done;
  root.append(
    h(
      'div',
      { class: 'honest-note', id: 'fit-honest' },
      h('strong', {}, 'Reminder: '),
      'these are REPORTED cases, not true infections (under-reporting, testing changes and delays are all folded into one fitted reporting fraction). The model is a simplified teaching model, so this is not a forecast and must not be used for public-health decisions.',
    ),
    verdictBanner(result),
  );
  const reliable = result.verdict.converged || showUnreliable;
  if (!result.verdict.converged) {
    if (!showUnreliable) {
      root.append(
        h(
          'p',
          {},
          'The fitted curve and parameter intervals are hidden because the run did not converge. You can still see why:',
        ),
      );
      const btn = h(
        'button',
        { type: 'button', class: 'btn', id: 'btn-show-unreliable' },
        'Show the numbers anyway (unreliable)',
      );
      btn.addEventListener('click', onShowUnreliable);
      root.append(btn);
    } else {
      root.append(
        h(
          'p',
          { class: 'error-note', role: 'alert' },
          'UNRELIABLE – shown only so you can see what a non-converged fit looks like.',
        ),
      );
    }
  }
  if (reliable) {
    const misfit = misfitWarnings(done.gof, done.ev.config.likelihood);
    if (misfit.length > 0) {
      root.append(
        h(
          'section',
          { class: 'honest-note misfit', id: 'fit-misfit', role: 'alert' },
          h('strong', {}, 'The model does not match these data well. '),
          h('ul', {}, ...misfit.map((m) => h('li', {}, m))),
        ),
      );
    }
  }
  if (result.warnings.length > 0) {
    root.append(
      h(
        'section',
        { class: 'card ex', id: 'fit-warnings' },
        h('h3', {}, 'What the data can and cannot tell us'),
        h('ul', {}, ...result.warnings.map((w) => h('li', { class: `warn-${w.kind}` }, w.message))),
      ),
    );
  }
  if (reliable) {
    root.append(
      fixedFittedTable(done),
      fittedChartSection(done, handles),
      posteriorSection(done),
      residualSection(done),
    );
    if (!result.verdict.converged) root.classList.add('unreliable');
    else root.classList.remove('unreliable');
  }
  const diag = h('div', { id: 'diag-body' });
  renderDiagnostics(diag, result);
  root.append(
    h(
      'details',
      { class: 'card ex', id: 'fit-diagnostics', open: !result.verdict.converged },
      h('summary', {}, 'Diagnostics (is the sampler trustworthy?)'),
      diag,
    ),
  );
}

/** Table of what was fitted vs fixed, with values and priors. */
function fixedFittedTable(done: FitDone): HTMLElement {
  const { result, ev } = done;
  const v = ev.config.values;
  const rows: HTMLElement[] = [];
  result.defs.forEach((d, j) => {
    const s = result.summaries[j];
    if (!s) return;
    const prior =
      d.transform === 'logit'
        ? `Beta(${(d.prior as { a: number }).a}, ${(d.prior as { b: number }).b})`
        : `lognormal, median ${fmtSig((d.prior as { median: number }).median, 3)}, spread ${fmtSig((d.prior as { sigmaLog: number }).sigmaLog, 3)}`;
    rows.push(
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, d.label),
        h('td', {}, 'FITTED'),
        h('td', {}, `${fmtSig(s.median, 3)} (95%: ${fmtSig(s.q025, 3)} – ${fmtSig(s.q975, 3)})`),
        h('td', {}, prior),
      ),
    );
  });
  const fixed: [string, string, boolean][] = [
    [
      'Incubation period (days)',
      String(v.incubationDays),
      ev.config.model === 'SEIR' && !result.defs.some((d) => d.name === 'incubation'),
    ],
    [
      'Infectious period (days)',
      String(v.infectiousDays),
      !result.defs.some((d) => d.name === 'infectious'),
    ],
    ['Initially infectious (I0)', String(v.i0), !result.defs.some((d) => d.name === 'i0')],
    ['Reporting fraction (rho)', String(v.rho), !result.defs.some((d) => d.name === 'rho')],
    ['Population N', String(ev.config.population), true],
    ['Reporting delay (days)', String(ev.config.reportingDelayDays), true],
  ];
  for (const [label, value, isFixed] of fixed)
    if (isFixed)
      rows.push(
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, label),
          h('td', {}, 'fixed'),
          h('td', {}, value),
          h('td', {}, 'not estimated'),
        ),
      );
  return h(
    'section',
    { class: 'card ex', id: 'fit-table-card' },
    h('h3', {}, 'Fixed vs fitted parameters'),
    h(
      'p',
      { class: 'small muted' },
      'Fixed values come from your setup, not from the data. Intervals are 95% credible intervals: given this model and these priors, there is a 95% chance the value lies inside.',
    ),
    h(
      'table',
      { class: 'data-table', id: 'fit-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Parameter'),
          h('th', {}, 'Status'),
          h('th', {}, 'Value'),
          h('th', {}, 'Prior'),
        ),
      ),
      h('tbody', {}, ...rows),
    ),
  );
}

/** Fitted curve with 50% and 95% predictive bands over the data points (and optional projection). */
function fittedChartSection(done: FitDone, handles: ResultsHandles): HTMLElement {
  const { series, pred, projection } = done;
  const canvas = h('canvas', {
    id: 'fit-chart',
    'aria-label': 'Fitted curve with uncertainty bands over the observed counts',
    role: 'img',
  });
  const box = h('div', { class: 'chart-box' }, canvas);
  const p = projection ?? pred;
  const n = p.intervals.length;
  const xs = p.intervals.map((iv) => iv.endDay);
  const line = (arr: number[], from = 0, to = n): { x: number; y: number }[] =>
    arr.slice(from, to).map((y, i) => ({ x: xs[from + i] as number, y }));
  const red = cssVar('--c-I');
  const blue = cssVar('--c-S');
  const sets: SeriesDef[] = [
    {
      label: '95% band low',
      color: 'rgba(0,114,178,0.14)',
      dash: [],
      width: 0,
      data: line(p.observed.q025),
      hideLegend: true,
    },
    {
      label: 'Where 95% of new observations are expected',
      color: 'rgba(0,114,178,0.14)',
      dash: [],
      width: 0,
      fill: '-1',
      data: line(p.observed.q975),
    },
    {
      label: '50% band low',
      color: 'rgba(0,114,178,0.26)',
      dash: [],
      width: 0,
      data: line(p.observed.q25),
      hideLegend: true,
    },
    {
      label: 'Where 50% of new observations are expected',
      color: 'rgba(0,114,178,0.26)',
      dash: [],
      width: 0,
      fill: '-1',
      data: line(p.observed.q75),
    },
    {
      label: 'Fitted expected cases (median)',
      color: blue,
      dash: [],
      width: 3,
      data: line(p.expected.median),
    },
    {
      label: 'Observed reported cases',
      color: red,
      dash: [],
      pointsOnly: true,
      data: series.counts.map((y, i) => ({ x: series.endDays[i] as number, y })),
    },
  ];
  const chart = new LineChart(canvas);
  handles.chart = chart;
  requestAnimationFrame(() =>
    chart.update({
      datasets: sets,
      yTitle: `Reported cases per ${series.intervalDays === 7 ? 'week' : 'day'}`,
      yFormat: 'count',
      bands: projection
        ? [
            {
              startDay: series.endDays[series.endDays.length - 1] as number,
              endDay: xs[n - 1] as number,
              kind: 'vaccination',
              label: 'Illustrative projection – NOT a forecast',
            },
          ]
        : [],
    }),
  );
  const rows = series.counts.map((y, i) => [
    series.dates?.[i] ?? series.endDays[i] ?? i,
    y,
    Math.round(pred.expected.median[i] as number),
    Math.round(pred.observed.q025[i] as number),
    Math.round(pred.observed.q975[i] as number),
  ]);
  return h(
    'section',
    { class: 'card ex', id: 'fit-chart-card' },
    h('h3', {}, 'Fitted curve'),
    h(
      'p',
      { class: 'small muted' },
      `Dots are the data. The solid line is the model's expected reported cases; the shaded bands show where new observations would fall if the model were right (parameter uncertainty plus random noise). Horizontal axis: days since the start of the first ${series.intervalDays === 7 ? 'week' : 'day'}${series.dates ? ` (${series.dates[0] ?? ''})` : ''}.`,
    ),
    box,
    dataTable(
      'Show data as a table',
      ['Date / day', 'Observed', 'Fitted (median)', '95% band low', '95% band high'],
      rows,
    ),
  );
}

/** Posterior histograms with the prior overlaid, the pairwise scatter and a summary table. */
function posteriorSection(done: FitDone): HTMLElement {
  const { result } = done;
  const grid = h('div', { class: 'hist-grid', id: 'hist-grid' });
  const rng = Rng.forStream(done.seed, 9_900_000);
  const naturalCols = result.defs.map((d, j) =>
    Float64Array.from(result.draws, (u) => toNaturalValue(d, u[j] as number)),
  );
  result.defs.forEach((d, j) => {
    const canvas = h('canvas', {
      class: 'mini-canvas',
      'aria-label': `Posterior of ${d.label} compared with its prior`,
      role: 'img',
    });
    grid.append(canvas);
    const prior = Float64Array.from({ length: 4000 }, () =>
      toNaturalValue(d, samplePriorU(d, rng)),
    );
    const s = result.summaries[j];
    requestAnimationFrame(() =>
      drawHistogram(
        canvas,
        naturalCols[j] as Float64Array,
        prior,
        d.label,
        s ? { median: s.median, low: s.q025, high: s.q975 } : undefined,
      ),
    );
  });
  const defs = result.defs;
  const a = defs.findIndex((d) => d.name === 'r0');
  const b =
    defs.findIndex((d) => d.name === 'rho') >= 0
      ? defs.findIndex((d) => d.name === 'rho')
      : defs.findIndex((_, i) => i !== a);
  const scatterBox = h('div', {});
  if (a >= 0 && b >= 0) {
    const r = correlation(naturalCols[a] as Float64Array, naturalCols[b] as Float64Array);
    const canvas = h('canvas', {
      class: 'mini-canvas',
      id: 'scatter',
      'aria-label': `Scatter of ${defs[a]?.label} against ${defs[b]?.label}`,
      role: 'img',
    });
    requestAnimationFrame(() =>
      drawScatter(
        canvas,
        naturalCols[a] as Float64Array,
        naturalCols[b] as Float64Array,
        defs[a]?.label ?? '',
        defs[b]?.label ?? '',
      ),
    );
    scatterBox.append(
      h('h3', {}, `${defs[a]?.label} vs ${defs[b]?.label}`),
      canvas,
      h(
        'p',
        {
          class: `small ${Math.abs(r) >= CORRELATION_WARN ? 'warn' : 'muted'}`,
          id: 'scatter-corr',
        },
        `Correlation ${r.toFixed(2)}. ${Math.abs(r) >= CORRELATION_WARN ? 'These two are strongly tied together: the data fix a combination of them far better than either one alone.' : 'Not strongly tied together.'}`,
      ),
    );
  }
  return h(
    'section',
    { class: 'card ex', id: 'fit-posterior-card' },
    h('h3', {}, 'What the data taught us about each parameter'),
    h(
      'p',
      { class: 'small muted' },
      'Filled bars: posterior (after seeing the data). Dashed outline: prior (before). If they look alike, the data told us little. Dotted vertical lines mark the 95% interval.',
    ),
    grid,
    scatterBox,
  );
}

/** Residual plot and goodness-of-fit summary. */
function residualSection(done: FitDone): HTMLElement {
  const { series, gof } = done;
  const canvas = h('canvas', {
    id: 'residual-chart',
    'aria-label': 'Standardised residuals over time',
    role: 'img',
  });
  const chart = new LineChart(canvas);
  requestAnimationFrame(() =>
    chart.update({
      datasets: [
        {
          label: 'Standardised residual (observed − fitted) / expected scatter',
          color: cssVar('--c-I'),
          dash: [],
          pointsOnly: true,
          data: gof.residuals.map((y, i) => ({ x: series.endDays[i] as number, y })),
        },
      ],
      yTitle: 'Standardised residual',
      yFormat: 'plain',
      hline: 0,
      yMin: Math.min(-3, ...gof.residuals) - 0.5,
    }),
  );
  const row = (k: string, v: string, note: string): HTMLElement =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, k),
      h('td', {}, v),
      h('td', { class: 'small muted' }, note),
    );
  return h(
    'section',
    { class: 'card ex', id: 'fit-gof-card' },
    h('h3', {}, 'How well does it fit?'),
    h('div', { class: 'chart-box short' }, canvas),
    h(
      'p',
      { class: 'small muted' },
      'Residuals show how far each observation is from the fitted curve, in units of expected random scatter. A good fit looks like a patternless cloud around 0, mostly between −2 and 2. Waves or trends mean the model shape is wrong.',
    ),
    h(
      'table',
      { class: 'data-table', id: 'gof-table' },
      h(
        'tbody',
        {},
        row(
          'R²',
          fmtSig(gof.r2, 3),
          'Share of the variation in the counts the fitted curve explains.',
        ),
        row('RMSE', fmtSig(gof.rmse, 3), 'Typical size of the error, in cases.'),
        row(
          'Within the 95% band',
          `${(gof.coverage95 * 100).toFixed(0)}%`,
          'Should be near 95% for a well-calibrated model.',
        ),
        row('Within the 50% band', `${(gof.coverage50 * 100).toFixed(0)}%`, 'Should be near 50%.'),
        row(
          'Pearson chi-square / n',
          fmtSig(gof.pearsonPerObservation, 3),
          'About 1 means the scatter matches the likelihood; much larger means extra scatter or a poor model shape (try negative binomial).',
        ),
      ),
    ),
  );
}

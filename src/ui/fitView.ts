// Fit mode: choose data (bundled sample, CSV file or synthetic), set up the model (fixed vs fitted, priors, likelihood),
// run the fit in workers, and show results with honest uncertainty and diagnostics.
import { buildSeries, parseCsvText, suggestMapping, trimSeries } from '../io/csv';
import type { ColumnMapping, ParsedCsv } from '../io/csv';
import { loadDataset } from '../io/datasets';
import { fitCsv } from '../io/export';
import type { DatasetEntry } from '../shared/schemas';
import type { ImportProblem, ObservedSeries, OutbreakScopeApi, TaskState } from '../shared/types';
import { generateSynthetic, makeEvaluator, suggestConfig } from '../sim/fit';
import type { FitConfig, FitParamName } from '../sim/fit';
import { assembleFit, DEFAULT_RUN } from '../sim/fitRun';
import type { FitRunOptions } from '../sim/fitRun';
import { PRESETS } from '../sim/presets';
import { bundledCsv, manifest } from './datasetFiles';
import { renderState } from './cards';
import { byId, clear, h } from './dom';
import { startFit } from './fitClient';
import type { FitJob } from './fitClient';
import { buildFitDone, buildProjection, renderFitResults } from './fitResults';
import type { FitDone, ResultsHandles } from './fitResults';
import { renderImportPanel } from './importDialog';
import { fmtInt } from './format';

export interface FitViewApi {
  /** Redraws charts (after a theme change). */
  redraw(): void;
  /** Native open dialog for a CSV, then import. */
  openCsv(): Promise<void>;
  exportCsv(): Promise<void>;
  exportPng(): Promise<void>;
}

const RUN_LENGTHS: Record<string, Pick<FitRunOptions, 'burnIn' | 'iterations' | 'thin'>> = {
  quick: { burnIn: 150, iterations: 300, thin: 1 },
  standard: { burnIn: 3000, iterations: 6000, thin: 6 },
  long: { burnIn: 6000, iterations: 15000, thin: 15 },
};

/** Builds the Fit view inside #view-fit and returns its API. */
export function initFitView(
  api: OutbreakScopeApi,
  notify: (msg: string, kind?: 'info' | 'error') => void,
  appVersion: () => string,
): FitViewApi {
  const root = byId('view-fit');
  let fullSeries: ObservedSeries | null = null;
  let series: ObservedSeries | null = null;
  let entry: DatasetEntry | null = null;
  let table: ParsedCsv | null = null;
  let fileLabel = '';
  let mapping: ColumnMapping = { dateColumn: 0, countColumn: 1, interval: 'auto' };
  let problems: ImportProblem[] = [];
  let trim = { from: 1, to: 1 };
  let config: FitConfig | null = null;
  let seed = 12345;
  let runLength = 'standard';
  let fitState: TaskState<FitDone> = { status: 'idle' };
  let showUnreliable = false;
  let projectionOn = false;
  let projectionSteps = 8;
  let job: FitJob | null = null;
  const handles: ResultsHandles = { chart: null };

  const dataBox = h('section', { class: 'card ex', id: 'fit-data' });
  const modelBox = h('section', { class: 'card ex', id: 'fit-model' });
  const runBox = h('section', { class: 'card ex', id: 'fit-run-card' });
  const resultsBox = h('div', { id: 'fit-results' });
  clear(root);
  root.append(
    h('h2', { id: 'h-fit' }, 'Fit to data'),
    h(
      'p',
      { class: 'muted' },
      'Fit the model to real or synthetic case counts and see how sure we can be. Nothing leaves your computer.',
    ),
    h(
      'div',
      { class: 'honest-note', id: 'fit-top-note' },
      h('strong', {}, 'Read this first: '),
      'reported case counts are not true infections (under-reporting, changes in testing and reporting delays all matter). The fitted "reporting fraction" absorbs all of that in a single number.',
    ),
    h('div', { class: 'fit-grid' }, dataBox, modelBox),
    runBox,
    resultsBox,
  );

  // ---------- data handling
  /** Installs a new full series and resets everything that depends on it. */
  function setSeries(s: ObservedSeries | null, e: DatasetEntry | null, label: string): void {
    fullSeries = s;
    entry = e;
    fileLabel = label;
    trim = { from: 1, to: s ? s.counts.length : 1 };
    series = s;
    fitState = { status: 'idle' };
    showUnreliable = false;
    if (s) {
      const preset = e?.id.startsWith('ut-flu')
        ? PRESETS.find((p) => p.id === 'seasonal-flu')
        : undefined;
      const synth = e?.synthetic;
      config = suggestConfig(s, {
        population:
          e?.populationHint?.value ?? synth?.population ?? config?.population ?? 1_000_000,
        model: preset ? 'SIR' : (synth?.model ?? 'SEIR'),
        infectiousDays: preset?.infectiousDays.value ?? synth?.infectiousDays ?? 5,
        incubationDays: synth?.incubationDays ?? 3,
      });
    }
    renderAll();
  }

  /** Applies the trim range to the full series. */
  function applyTrim(): void {
    if (!fullSeries) return;
    const from = Math.max(1, Math.min(trim.from, fullSeries.counts.length));
    const to = Math.max(from, Math.min(trim.to, fullSeries.counts.length));
    trim = { from, to };
    series = to - from + 1 >= 5 ? trimSeries(fullSeries, from - 1, to - 1) : fullSeries;
    if (to - from + 1 < 5)
      notify('At least 5 observations are needed; the range was not applied.', 'error');
    fitState = { status: 'idle' };
    renderAll();
  }

  /** Imports CSV text (from the native dialog), showing every problem found. */
  function importText(text: string, name: string): void {
    table = parseCsvText(text);
    mapping = suggestMapping(table);
    rebuildFromTable(name);
  }

  /** (Re)builds the series from the current table and column mapping. */
  function rebuildFromTable(name: string): void {
    if (!table) return;
    const r = buildSeries(table, mapping, name);
    problems = r.problems;
    if (r.ok) setSeries(r.series, null, name);
    else {
      fullSeries = null;
      series = null;
      entry = null;
      fileLabel = name;
      fitState = { status: 'idle' };
      renderAll();
    }
  }

  // ---------- rendering: data card
  /** Draws the data card. */
  function renderData(): void {
    clear(dataBox);
    const sample = h(
      'select',
      { id: 'fit-sample', 'aria-label': 'Bundled sample datasets' },
      h('option', { value: '' }, 'Choose a sample dataset…'),
    );
    if (manifest.ok)
      for (const d of manifest.datasets)
        sample.append(
          h('option', { value: d.id }, `${d.kind === 'synthetic' ? '[synthetic] ' : ''}${d.title}`),
        );
    sample.value = entry?.id ?? '';
    sample.addEventListener('change', () => {
      if (!manifest.ok) return;
      const d = manifest.datasets.find((x) => x.id === sample.value);
      if (!d) return;
      const text = bundledCsv(d.file);
      if (text === undefined) {
        notify(`The bundled file ${d.file} is missing from this build.`, 'error');
        return;
      }
      const r = loadDataset(d, text);
      table = null;
      problems = r.problems;
      if (r.ok) setSeries(r.series, d, d.title);
      else renderAll();
    });
    const open = h('button', { type: 'button', class: 'btn', id: 'fit-open' }, 'Open CSV file…');
    open.addEventListener('click', () => void openCsv());
    dataBox.append(
      h('h3', {}, '1. Data'),
      h('div', { class: 'row-gap' }, sample, open),
      syntheticForm(),
    );
    if (manifest.ok === false)
      dataBox.append(h('p', { class: 'error-note', role: 'alert' }, manifest.message));
    if (entry) dataBox.append(datasetInfo(entry, api, notify));
    if (table) {
      const panel = h('div', { id: 'import-panel' });
      renderImportPanel(panel, table, mapping, problems, {
        onMappingChange: (m) => {
          mapping = m;
          rebuildFromTable(fileLabel);
        },
      });
      dataBox.append(panel);
    } else if (problems.length > 0) {
      dataBox.append(
        h(
          'ul',
          { class: 'problems' },
          ...problems.map((p) => h('li', { class: `prob prob-${p.severity}` }, p.message)),
        ),
      );
    }
    if (series && fullSeries) {
      const total = series.counts.reduce((a, b) => a + b, 0);
      const first = h('input', {
        type: 'number',
        class: 'num small-num',
        id: 'trim-from',
        min: 1,
        max: fullSeries.counts.length,
        value: trim.from,
        'aria-label': 'First observation to use',
      });
      const last = h('input', {
        type: 'number',
        class: 'num small-num',
        id: 'trim-to',
        min: 1,
        max: fullSeries.counts.length,
        value: trim.to,
        'aria-label': 'Last observation to use',
      });
      const onTrim = (): void => {
        trim = {
          from: first.valueAsNumber || 1,
          to: last.valueAsNumber || fullSeries?.counts.length || 1,
        };
        applyTrim();
      };
      first.addEventListener('change', onTrim);
      last.addEventListener('change', onTrim);
      dataBox.append(
        h(
          'p',
          { class: 'small', id: 'fit-summary' },
          `Using ${series.counts.length} of ${fullSeries.counts.length} observations (${series.intervalDays === 7 ? 'weekly' : 'daily'}), ${fmtInt(total)} reported cases in total${series.dates ? `, ${series.dates[0]} to ${series.dates[series.dates.length - 1]}` : ''}.`,
        ),
        h(
          'div',
          { class: 'row-gap' },
          h(
            'label',
            { class: 'mini' },
            h('span', { class: 'small muted' }, 'First observation #'),
            first,
          ),
          h(
            'label',
            { class: 'mini' },
            h('span', { class: 'small muted' }, 'Last observation #'),
            last,
          ),
        ),
      );
    }
  }

  /** Small form that creates synthetic data from known parameters (seeded, so it is reproducible). */
  function syntheticForm(): HTMLElement {
    const f = (id: string, label: string, v: number, step = 'any'): HTMLElement =>
      h(
        'label',
        { class: 'mini' },
        h('span', { class: 'small muted' }, label),
        h('input', { type: 'number', id, class: 'num small-num', value: v, step }),
      );
    const kind = h(
      'select',
      { id: 'syn-noise', 'aria-label': 'Noise type' },
      h('option', { value: 'poisson' }, 'Poisson noise'),
      h('option', { value: 'negbin' }, 'extra scatter (negative binomial, k = 5)'),
    );
    const btn = h(
      'button',
      { type: 'button', class: 'btn', id: 'syn-make' },
      'Generate synthetic data',
    );
    btn.addEventListener('click', () => {
      const num = (id: string): number => byId<HTMLInputElement>(id).valueAsNumber;
      const N = num('syn-N');
      const truth = {
        r0: num('syn-r0'),
        i0: num('syn-i0'),
        rho: num('syn-rho'),
        dispersion: 5,
        incubationDays: 3,
        infectiousDays: 5,
      };
      const likelihood = kind.value === 'negbin' ? 'negbin' : 'poisson';
      const base = suggestConfig(
        { label: '', counts: [1], endDays: [7], intervalDays: 7, dates: null },
        { population: N, model: 'SEIR' },
      );
      const cfg: FitConfig = { ...base, values: { ...base.values, ...truth }, likelihood };
      try {
        const s = generateSynthetic({
          config: cfg,
          truth,
          intervalDays: 7,
          observations: Math.round(num('syn-weeks')),
          seed: Math.round(num('syn-seed')),
          label: `Synthetic (R0 ${truth.r0}, rho ${truth.rho}, seed ${num('syn-seed')})`,
        });
        table = null;
        problems = [
          {
            severity: 'info',
            line: null,
            message:
              'Synthetic data made by OutbreakScope: not real. The true values are known, so you can check the fit against them.',
          },
        ];
        setSeries(s, null, s.label);
        if (config)
          config = {
            ...config,
            population: N,
            values: { ...config.values, incubationDays: 3, infectiousDays: 5 },
          };
        renderAll();
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Could not generate synthetic data.', 'error');
      }
    });
    return h(
      'details',
      { class: 'synthetic' },
      h('summary', {}, 'Generate synthetic data (known truth)'),
      h(
        'div',
        { class: 'row-gap' },
        f('syn-r0', 'True R0', 2.4),
        f('syn-i0', 'True I0', 15),
        f('syn-rho', 'True reporting fraction', 0.25),
        f('syn-N', 'Population', 1_000_000, '1'),
        f('syn-weeks', 'Weeks', 26, '1'),
        f('syn-seed', 'Seed', 31, '1'),
        kind,
        btn,
      ),
    );
  }

  // ---------- rendering: model card
  /** Draws the model setup card. */
  function renderModel(): void {
    clear(modelBox);
    modelBox.append(h('h3', {}, '2. Model'));
    if (!config || !series) {
      modelBox.append(
        h('p', { class: 'muted', 'data-state': 'empty' }, 'Choose or import data first.'),
      );
      return;
    }
    const c = config;
    const update = (next: FitConfig): void => {
      config = next;
      fitState = { status: 'idle' };
      renderModel();
      renderRun();
      renderResults();
    };
    const model = h(
      'select',
      { id: 'fit-model-select', 'aria-label': 'Model' },
      h('option', { value: 'SIR' }, 'SIR (no incubation stage)'),
      h('option', { value: 'SEIR' }, 'SEIR (with incubation stage)'),
    );
    model.value = c.model;
    model.addEventListener('change', () =>
      update({
        ...c,
        model: model.value === 'SIR' ? 'SIR' : 'SEIR',
        fitted: c.fitted.filter((n) => n !== 'incubation'),
      }),
    );
    const like = h(
      'select',
      { id: 'fit-like', 'aria-label': 'Likelihood' },
      h('option', { value: 'poisson' }, 'Poisson (counts vary like pure chance)'),
      h('option', { value: 'negbin' }, 'Negative binomial (allows extra scatter)'),
    );
    like.value = c.likelihood;
    like.addEventListener('change', () => {
      const negbin = like.value === 'negbin';
      update({
        ...c,
        likelihood: negbin ? 'negbin' : 'poisson',
        fitted: negbin
          ? [...new Set<FitParamName>([...c.fitted, 'dispersion'])]
          : c.fitted.filter((n) => n !== 'dispersion'),
      });
    });
    const num = (
      id: string,
      label: string,
      v: number,
      apply: (x: number) => FitConfig,
      step: string | number = 'any',
    ): HTMLElement => {
      const input = h('input', {
        type: 'number',
        id,
        class: 'num',
        value: v,
        step,
        'aria-label': label,
      });
      input.addEventListener('change', () => update(apply(input.valueAsNumber)));
      return h('label', { class: 'mini' }, h('span', { class: 'small muted' }, label), input);
    };
    const preset = h(
      'select',
      { id: 'fit-preset', 'aria-label': 'Take the periods from a preset' },
      h('option', { value: '' }, 'Take periods from a preset…'),
    );
    for (const p of PRESETS.filter((x) => x.sources.length > 0))
      preset.append(h('option', { value: p.id }, p.name));
    preset.addEventListener('change', () => {
      const p = PRESETS.find((x) => x.id === preset.value);
      if (p)
        update({
          ...c,
          model: p.model === 'SIR' ? 'SIR' : 'SEIR',
          values: {
            ...c.values,
            infectiousDays: p.infectiousDays.value,
            incubationDays: p.incubationDays?.value ?? c.values.incubationDays,
          },
        });
    });
    modelBox.append(
      h('div', { class: 'row-gap' }, model, like),
      h(
        'div',
        { class: 'row-gap' },
        num(
          'fit-pop',
          'Population N',
          c.population,
          (x) => ({ ...c, population: Math.round(x) }),
          1,
        ),
        num(
          'fit-delay',
          'Reporting delay (days)',
          c.reportingDelayDays,
          (x) => ({ ...c, reportingDelayDays: Math.max(0, Math.min(14, Math.round(x))) }),
          1,
        ),
      ),
      entry?.populationHint
        ? h('p', { class: 'small muted' }, `${entry.populationHint.description}.`)
        : h(
            'p',
            { class: 'small muted' },
            'The population is not part of the data: set it yourself. Because the fitted reporting fraction scales with it, N and the reporting fraction can trade off.',
          ),
      h('div', { class: 'row-gap' }, preset),
      h(
        'p',
        { class: 'small' },
        h('strong', {}, 'Fixed vs fitted: '),
        'fixing parameters from outside knowledge is the honest default, because case counts rarely contain enough information to pin down everything at once (for example, the growth rate fixes a combination of R0 and the infectious period, not each alone). Fit only what you must.',
      ),
      paramTable(c, update),
      h(
        'details',
        { class: 'synthetic' },
        h('summary', {}, 'Priors, in plain words'),
        h(
          'p',
          { class: 'small muted' },
          'A prior is what we believe before seeing the data. Lognormal "spread" is the standard deviation of ln(value): 0.5 means about ×1.65 per step. Edit the priors in the table above; wide priors let the data speak but can leave parameters undetermined.',
        ),
      ),
    );
  }

  /** Table of parameters with fitted checkbox, value and prior inputs. */
  function paramTable(c: FitConfig, update: (n: FitConfig) => void): HTMLElement {
    const rows: HTMLElement[] = [];
    type Row = {
      name: FitParamName;
      label: string;
      value: number;
      locked?: boolean;
      show: boolean;
      priorKind: 'lognormal' | 'beta';
      hint: string;
    };
    const list: Row[] = [
      {
        name: 'r0',
        label: 'R0',
        value: c.values.r0,
        locked: true,
        show: true,
        priorKind: 'lognormal',
        hint: 'Average infections per case in a fully susceptible population.',
      },
      {
        name: 'i0',
        label: 'Initially infectious (I0)',
        value: c.values.i0,
        show: true,
        priorKind: 'lognormal',
        hint: 'People infectious at the start of the data window.',
      },
      {
        name: 'rho',
        label: 'Reporting fraction (rho)',
        value: c.values.rho,
        show: true,
        priorKind: 'beta',
        hint: 'Share of onsets that show up as reported cases (absorbs under-reporting).',
      },
      {
        name: 'dispersion',
        label: 'Dispersion (k)',
        value: c.values.dispersion,
        locked: c.likelihood === 'negbin',
        show: c.likelihood === 'negbin',
        priorKind: 'lognormal',
        hint: 'Smaller k = more extra scatter than pure chance.',
      },
      {
        name: 'incubation',
        label: 'Incubation period (days)',
        value: c.values.incubationDays,
        show: c.model === 'SEIR',
        priorKind: 'lognormal',
        hint: 'Average days from infection to becoming infectious.',
      },
      {
        name: 'infectious',
        label: 'Infectious period (days)',
        value: c.values.infectiousDays,
        show: true,
        priorKind: 'lognormal',
        hint: 'Average days a person is infectious.',
      },
    ];
    for (const r of list) {
      if (!r.show) continue;
      const fitted =
        c.fitted.includes(r.name) ||
        r.name === 'r0' ||
        (r.name === 'dispersion' && c.likelihood === 'negbin');
      const cb = h('input', {
        type: 'checkbox',
        id: `fit-${r.name}-on`,
        checked: fitted,
        disabled: r.locked,
        'aria-label': `Fit ${r.label}`,
      });
      cb.addEventListener('change', () =>
        update({
          ...c,
          fitted: cb.checked
            ? [...new Set([...c.fitted, r.name])]
            : c.fitted.filter((n) => n !== r.name),
        }),
      );
      const key =
        r.name === 'incubation'
          ? 'incubationDays'
          : r.name === 'infectious'
            ? 'infectiousDays'
            : r.name;
      const valueInput = h('input', {
        type: 'number',
        class: 'num small-num',
        id: `fit-${r.name}-val`,
        step: 'any',
        value: Number(r.value.toPrecision(5)),
        'aria-label': `${r.label}: ${fitted ? 'starting' : 'fixed'} value`,
      });
      valueInput.addEventListener('change', () =>
        update({ ...c, values: { ...c.values, [key]: valueInput.valueAsNumber } }),
      );
      const priorCells: HTMLElement[] = [];
      if (fitted) {
        if (r.priorKind === 'beta') {
          for (const k of ['a', 'b'] as const) {
            const inp = h('input', {
              type: 'number',
              class: 'num tiny-num',
              step: 'any',
              value: c.priors.rho[k],
              'aria-label': `Prior Beta ${k}`,
            });
            inp.addEventListener('change', () =>
              update({
                ...c,
                priors: { ...c.priors, rho: { ...c.priors.rho, [k]: inp.valueAsNumber } },
              }),
            );
            priorCells.push(
              h('label', { class: 'mini' }, h('span', { class: 'small muted' }, `Beta ${k}`), inp),
            );
          }
        } else {
          const p = c.priors[r.name as 'r0' | 'i0' | 'dispersion' | 'incubation' | 'infectious'];
          for (const [k, lab] of [
            ['median', 'median'],
            ['sigmaLog', 'spread'],
          ] as const) {
            const inp = h('input', {
              type: 'number',
              class: 'num tiny-num',
              step: 'any',
              value: Number(p[k].toPrecision(4)),
              'aria-label': `Prior ${lab} for ${r.label}`,
            });
            inp.addEventListener('change', () =>
              update({ ...c, priors: { ...c.priors, [r.name]: { ...p, [k]: inp.valueAsNumber } } }),
            );
            priorCells.push(
              h('label', { class: 'mini' }, h('span', { class: 'small muted' }, lab), inp),
            );
          }
        }
      }
      rows.push(
        h(
          'tr',
          {},
          h('td', {}, cb),
          h('th', { scope: 'row' }, r.label, h('div', { class: 'small muted' }, r.hint)),
          h('td', {}, valueInput),
          h('td', {}, h('div', { class: 'row-gap' }, ...priorCells)),
        ),
      );
    }
    return h(
      'table',
      { class: 'data-table param-table', id: 'fit-param-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Fit?'),
          h('th', {}, 'Parameter'),
          h('th', {}, 'Value (fixed / start)'),
          h('th', {}, 'Prior (fitted only)'),
        ),
      ),
      h('tbody', {}, ...rows),
    );
  }

  // ---------- running
  /** Draws the run controls. */
  function renderRun(): void {
    clear(runBox);
    const run = h(
      'button',
      {
        type: 'button',
        class: 'btn primary',
        id: 'fit-run',
        disabled: !series || !config || fitState.status === 'running',
      },
      fitState.status === 'running' ? 'Fitting…' : 'Fit the model',
    );
    run.addEventListener('click', () => runFit());
    const len = h(
      'select',
      { id: 'fit-length', 'aria-label': 'Run length' },
      h('option', { value: 'quick' }, 'Quick (a few seconds; may NOT converge)'),
      h('option', { value: 'standard' }, 'Standard'),
      h('option', { value: 'long' }, 'Long (most reliable)'),
    );
    len.value = runLength;
    len.addEventListener('change', () => {
      runLength = len.value;
    });
    const seedIn = h('input', {
      type: 'number',
      class: 'num',
      id: 'fit-seed',
      value: seed,
      'aria-label': 'Random seed for the fit',
    });
    seedIn.addEventListener('change', () => {
      seed = Math.max(0, Math.round(seedIn.valueAsNumber) || 0);
    });
    runBox.append(
      h('h3', {}, '3. Fit'),
      h(
        'div',
        { class: 'row-gap' },
        run,
        len,
        h('label', { class: 'mini' }, h('span', { class: 'small muted' }, 'Seed'), seedIn),
      ),
      h(
        'p',
        { class: 'small muted' },
        'Step 1 finds the best-fitting values (Nelder–Mead from several starting points). Step 2 runs 4 independent Metropolis chains to measure uncertainty, in background workers; you can cancel at any time. The seed makes every run reproducible.',
      ),
    );
  }

  /** Starts the two-stage fit in workers. */
  function runFit(): void {
    if (!series || !config || fitState.status === 'running') return;
    const cfg = config;
    const s = series;
    const ev = makeEvaluator(cfg, s);
    const start = ev.defs.map((d) => {
      const key =
        d.name === 'incubation'
          ? 'incubationDays'
          : d.name === 'infectious'
            ? 'infectiousDays'
            : d.name;
      return d.transform === 'log'
        ? Math.log(cfg.values[key])
        : Math.log(cfg.values[key] / (1 - cfg.values[key]));
    });
    if (!Number.isFinite(ev.logPosterior(start))) {
      fitState = {
        status: 'error',
        message:
          'These starting values give zero probability for the data (for example a population that is far too small, or a value outside its allowed range). Adjust them and try again.',
      };
      renderRun();
      renderResults();
      return;
    }
    const options: FitRunOptions = {
      ...DEFAULT_RUN,
      ...(RUN_LENGTHS[runLength] ?? RUN_LENGTHS['standard']),
      seed,
    };
    showUnreliable = false;
    fitState = { status: 'running', progress: 0, label: 'Starting…' };
    renderRun();
    renderResults();
    const thisJob = startFit(cfg, s, options, (fraction, stage) => {
      if (fitState.status === 'running') {
        fitState = { status: 'running', progress: fraction, label: stage };
        renderState(resultsBox, fitState, {
          idleText: '',
          done: () => undefined,
          onCancel: () => job?.cancel(),
        });
      }
    });
    job = thisJob;
    void thisJob.result.then((o) => {
      if (job !== thisJob) return;
      job = null;
      if (o.status === 'done') {
        // Hand the finishing work (diagnostics + predictive bands, ~0.5 s) to the next tick so the UI can repaint first.
        setTimeout(() => {
          const result = assembleFit(ev, o.optim, o.chains);
          fitState = {
            status: 'done',
            result: buildFitDone(result, ev, s, seed, projectionOn ? projectionSteps : 0),
          };
          renderRun();
          renderResults();
        }, 0);
        return;
      }
      fitState =
        o.status === 'cancelled'
          ? { status: 'cancelled' }
          : { status: 'error', message: `The fit failed: ${o.message}` };
      renderRun();
      renderResults();
    });
  }

  // ---------- rendering: results
  /** Draws the results area for the current fit state. */
  function renderResults(): void {
    clear(resultsBox);
    const container = h('div', { id: 'fit-results-body' });
    resultsBox.append(container);
    if (fitState.status === 'done') {
      resultsBox.prepend(projectionControls());
    }
    renderState(container, fitState, {
      idleText: series
        ? 'Set up the model above and press “Fit the model”.'
        : 'Choose a dataset to begin.',
      onCancel: () => job?.cancel(),
      onRetry: () => runFit(),
      done: (c, d) =>
        renderFitResults(
          c,
          d,
          showUnreliable,
          () => {
            showUnreliable = true;
            renderResults();
          },
          handles,
        ),
    });
  }

  /** Optional illustrative projection beyond the data (clearly labelled as not a forecast). */
  function projectionControls(): HTMLElement {
    const cb = h('input', { type: 'checkbox', id: 'fit-projection', checked: projectionOn });
    const steps = h('input', {
      type: 'number',
      class: 'num small-num',
      id: 'fit-proj-steps',
      min: 1,
      max: 52,
      value: projectionSteps,
      'aria-label': 'Intervals to project',
    });
    const apply = (): void => {
      projectionOn = cb.checked;
      projectionSteps = Math.max(1, Math.min(52, Math.round(steps.valueAsNumber) || 8));
      if (fitState.status === 'done') {
        const d = fitState.result;
        fitState = {
          status: 'done',
          result: {
            ...d,
            projection: projectionOn
              ? buildProjection(d.result, d.ev, d.series, d.seed, projectionSteps)
              : null,
          },
        };
        renderResults();
      }
    };
    cb.addEventListener('change', apply);
    steps.addEventListener('change', apply);
    return h(
      'div',
      { class: 'row-gap proj-controls' },
      h(
        'label',
        { class: 'chk' },
        cb,
        ' Show an illustrative projection beyond the data (not a forecast)',
      ),
      h('label', { class: 'mini' }, h('span', { class: 'small muted' }, 'intervals ahead'), steps),
    );
  }

  /** Redraws all cards. */
  function renderAll(): void {
    renderData();
    renderModel();
    renderRun();
    renderResults();
  }

  // ---------- public operations
  /** Native open dialog for a CSV file, then import (every problem is shown). */
  async function openCsv(): Promise<void> {
    const res = await api.openFile({ kind: 'csv' });
    if (!res.ok) {
      if (res.reason !== 'cancelled') notify(res.message, 'error');
      return;
    }
    importText(res.text, res.name);
    notify(`Read ${res.name}.`);
  }

  renderAll();
  return {
    redraw: () => renderResults(),
    openCsv,
    async exportCsv() {
      if (fitState.status !== 'done') {
        notify('Run a fit first, then export it.', 'error');
        return;
      }
      const d = fitState.result;
      const r = d.result;
      const p = d.projection ?? d.pred;
      const rows = p.intervals.map((iv, i) => ({
        day: iv.endDay,
        date: d.series.dates?.[i] ?? '',
        observed: i < d.series.counts.length ? (d.series.counts[i] as number) : null,
        expMedian: p.expected.median[i] as number,
        expLow: p.expected.q025[i] as number,
        expHigh: p.expected.q975[i] as number,
        predLow: p.observed.q025[i] as number,
        predHigh: p.observed.q975[i] as number,
      }));
      const v = d.ev.config.values;
      const csv = fitCsv(
        {
          label: d.series.label,
          modelLine: `model=${d.ev.config.model} likelihood=${d.ev.config.likelihood} population=${d.ev.config.population} reporting_delay_days=${d.ev.config.reportingDelayDays}`,
          fixedFitted: [
            `fitted: ${r.defs.map((x) => x.name).join(', ')}`,
            `fixed values: incubation_days=${v.incubationDays} infectious_days=${v.infectiousDays} i0=${v.i0} rho=${v.rho}`,
          ],
          converged: r.verdict.converged,
          seed: d.seed,
          rows,
          parameters: r.defs.map((def, j) => ({
            name: def.name,
            median: r.summaries[j]?.median ?? NaN,
            low: r.summaries[j]?.q025 ?? NaN,
            high: r.summaries[j]?.q975 ?? NaN,
            rhat: r.diagnostics[j]?.rhat ?? NaN,
            ess: r.diagnostics[j]?.ess ?? NaN,
          })),
        },
        appVersion(),
      );
      const res = await api.saveFile({
        kind: 'csv',
        defaultName: 'outbreakscope-fit.csv',
        data: csv,
        encoding: 'utf8',
      });
      if (res.ok) notify(`Fit saved as ${res.name}.`);
      else if (res.reason !== 'cancelled') notify(res.message, 'error');
    },
    async exportPng() {
      if (!handles.chart) {
        notify('Run a fit first (and show its results), then export the chart.', 'error');
        return;
      }
      const res = await api.saveFile({
        kind: 'png',
        defaultName: 'outbreakscope-fit.png',
        data: handles.chart.toPngBase64(),
        encoding: 'base64',
      });
      if (res.ok) notify(`Chart saved as ${res.name}.`);
      else if (res.reason !== 'cancelled') notify(res.message, 'error');
    },
  };
}

/** Shows a bundled dataset's provenance: source link, licence, citation, what was done to the file, and caveats. */
function datasetInfo(
  d: DatasetEntry,
  api: OutbreakScopeApi,
  notify: (m: string, k?: 'info' | 'error') => void,
): HTMLElement {
  const link = (label: string, url: string): HTMLElement => {
    const a = h('a', { href: url, class: 'ext-link' }, label);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void api.openExternal(url).then((r) => !r.ok && notify(r.message, 'error'));
    });
    return a;
  };
  return h(
    'div',
    { class: 'dataset-info', id: 'dataset-info' },
    h(
      'p',
      { class: 'small' },
      h('strong', {}, d.kind === 'synthetic' ? 'Synthetic (not real data). ' : 'Real data. '),
      d.measures,
      '.',
    ),
    d.source
      ? h(
          'p',
          { class: 'small' },
          'Source: ',
          link(d.source.name, d.source.url),
          `. Retrieved ${d.source.retrieved}; ${d.source.query}.`,
        )
      : h('p', { class: 'small' }, 'Source: none; generated by this app.'),
    d.license
      ? h(
          'p',
          { class: 'small' },
          h('strong', {}, 'Licence: '),
          d.license.name,
          ' (',
          link('terms', d.license.termsUrl),
          '). ',
          h('span', { class: 'muted' }, d.license.note),
        )
      : null,
    h('p', { class: 'small muted' }, `Citation: ${d.citation}`),
    h('p', { class: 'small muted' }, `What was done to the file: ${d.transformation}`),
    h('ul', { class: 'small' }, ...d.caveats.map((c) => h('li', {}, c))),
  );
}

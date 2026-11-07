// Scenario mode: connects the store, controls, timeline, charts, results, ensemble workers, comparison and exports.
import { deterministicCsv, ensembleCsv } from '../io/export';
import { parseScenarioFile, serializeScenario } from '../io/session';
import type { Compartment, OutbreakScopeApi, Scenario, TaskState } from '../shared/types';
import { bandsOf, summarizeEnsemble } from '../sim/ensemble';
import type { EnsembleData, EnsembleSummary } from '../sim/ensemble';
import { MODEL_INFO } from '../sim/models';
import { runScenario, validateScenario } from '../sim/scenario';
import type { ScenarioResult } from '../sim/scenario';
import { renderState } from './cards';
import { renderCompare } from './compare';
import { buildControls } from './controls';
import { dataTable } from './dataTable';
import { byId, clear, h } from './dom';
import { EnsembleChart } from './ensembleChart';
import { startEnsemble } from './ensembleClient';
import type { EnsembleJob } from './ensembleClient';
import { fmtInt } from './format';
import { LineChart } from './lineChart';
import type { Band, SeriesDef } from './lineChart';
import { COMPARTMENT_DASH, COMPARTMENT_NAME, SCENARIO_STYLES, compartmentColor } from './palette';
import { fizzlePanel, renderResults } from './resultsPanel';
import type { ScenarioStore } from './store';
import { buildTimeline } from './timeline';
import { cssVar } from './dom';

type Tab = 'compartments' | 'incidence' | 'reff' | 'stochastic' | 'compare';
const TABS: { id: Tab; label: string }[] = [
  { id: 'compartments', label: 'Compartments' },
  { id: 'incidence', label: 'New infections' },
  { id: 'reff', label: 'R_eff over time' },
  { id: 'stochastic', label: 'Stochastic runs' },
  { id: 'compare', label: 'Compare scenarios' },
];

interface EnsembleDone {
  data: EnsembleData;
  method: 'gillespie' | 'chain_binomial';
  summary: EnsembleSummary;
  key: string;
  scenario: Scenario;
}

export interface SimulatorApi {
  /** Redraws charts (after a theme change). */
  redraw(): void;
  saveScenarioFile(): Promise<void>;
  openScenarioFile(): Promise<void>;
  exportCsv(): Promise<void>;
  exportPng(): Promise<void>;
  /** Space bar: run the stochastic ensemble, or cancel it if running. */
  toggleRun(): void;
}

/** A key that changes whenever anything affecting a stochastic run changes. */
function scenarioKey(s: Scenario): string {
  return JSON.stringify({ p: s.params, i: s.interventions, seed: s.seed, n: s.ensembleSize });
}

/** Builds the Scenario-mode UI inside the existing HTML shell and returns its imperative API. */
export function initSimulator(
  store: ScenarioStore,
  api: OutbreakScopeApi,
  appVersion: () => string,
  notify: (msg: string, kind?: 'info' | 'error') => void,
): SimulatorApi {
  const controls = buildControls(
    byId('controls-main'),
    store,
    (url) => void api.openExternal(url).then((r) => !r.ok && notify(r.message, 'error')),
  );
  const timeline = buildTimeline(byId('timeline-root'), store);

  // ---- tabs
  const tabList = byId('tablist');
  const panels = new Map<Tab, HTMLElement>();
  let activeTab: Tab = 'compartments';
  for (const t of TABS) {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        'aria-controls': `panel-${t.id}`,
        'aria-selected': t.id === activeTab,
        tabindex: t.id === activeTab ? 0 : -1,
        class: 'tab',
      },
      t.label,
    );
    btn.addEventListener('click', () => selectTab(t.id));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((x) => x.id === activeTab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        if (n) {
          selectTab(n.id);
          byId(`tab-${n.id}`).focus();
        }
      }
    });
    tabList.append(btn);
    panels.set(t.id, byId(`panel-${t.id}`));
  }

  // ---- view options (shared)
  const optPercent = byId<HTMLInputElement>('opt-percent');
  const optLog = byId<HTMLInputElement>('opt-log');
  const compBoxes = byId('opt-compartments');
  const shown: Record<Compartment, boolean> = { S: true, E: true, I: true, R: true, V: true };
  for (const c of ['S', 'E', 'I', 'R', 'V'] as const) {
    const cb = h('input', {
      type: 'checkbox',
      checked: true,
      id: `show-${c}`,
      'aria-label': `Show ${COMPARTMENT_NAME[c]}`,
    });
    cb.addEventListener('change', () => {
      shown[c] = cb.checked;
      schedule();
    });
    compBoxes.append(h('label', { class: 'chk', 'data-comp': c }, cb, ` ${c}`));
  }
  const incMode = byId<HTMLSelectElement>('inc-mode');
  for (const el of [optPercent, optLog, incMode]) el.addEventListener('change', schedule);

  // ---- charts
  const mainChart = new LineChart(byId<HTMLCanvasElement>('chart-main'));
  const incChart = new LineChart(byId<HTMLCanvasElement>('chart-inc'));
  const reffChart = new LineChart(byId<HTMLCanvasElement>('chart-reff'));
  const cmpChart = new LineChart(byId<HTMLCanvasElement>('chart-cmp'));
  const ensChart = new EnsembleChart(byId<HTMLCanvasElement>('chart-ens'), byId('ens-readout'));

  // ---- ensemble state
  let ensembleState: TaskState<EnsembleDone> = { status: 'idle' };
  let job: EnsembleJob | null = null;
  const ensSeries = byId<HTMLSelectElement>('ens-series');
  ensSeries.addEventListener('change', schedule);
  const runBtn = byId<HTMLButtonElement>('btn-run');
  runBtn.addEventListener('click', () => runEnsemble());

  // ---- scenario slots
  const saved: Record<'A' | 'B' | 'C', ScenarioResult | null> = { A: null, B: null, C: null };
  const overlay: Record<'A' | 'B' | 'C', boolean> = { A: true, B: true, C: true };
  const slotBox = byId('slot-buttons');
  const overlayBox = byId('overlay-toggles');
  for (const key of ['A', 'B', 'C'] as const) {
    const b = h(
      'button',
      { type: 'button', class: 'btn small-btn', id: `save-${key}` },
      `Save as ${key}`,
    );
    b.addEventListener('click', () => {
      if (current === null) {
        notify('Fix the invalid values before saving a scenario.', 'error');
        return;
      }
      saved[key] = current;
      notify(`Saved the current setup as Scenario ${key}.`);
      schedule();
    });
    slotBox.append(b);
    const cb = h('input', { type: 'checkbox', checked: true, id: `overlay-${key}` });
    cb.addEventListener('change', () => {
      overlay[key] = cb.checked;
      schedule();
    });
    overlayBox.append(h('label', { class: 'chk' }, cb, ` Show ${key}`));
  }
  const baselineSel = byId<HTMLSelectElement>('baseline-select');
  let baselineChosen = false;
  baselineSel.addEventListener('change', () => {
    baselineChosen = true;
    schedule();
  });

  let current: ScenarioResult | null = null;
  let raf = 0;

  /** Coalesces many quick changes (slider drags) into one redraw per animation frame. */
  function schedule(): void {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  /** Switches the visible chart tab. */
  function selectTab(id: Tab): void {
    activeTab = id;
    for (const t of TABS) {
      const sel = t.id === id;
      byId(`tab-${t.id}`).setAttribute('aria-selected', String(sel));
      byId(`tab-${t.id}`).tabIndex = sel ? 0 : -1;
      const panel = panels.get(t.id);
      if (panel) panel.hidden = !sel;
    }
    for (const c of [mainChart, incChart, reffChart, cmpChart]) c.chart.resize();
    ensChart.draw();
    schedule();
  }

  /** Converts a Float64Array of counts into chart points, honouring percent and log options. */
  function points(
    times: Float64Array,
    values: ArrayLike<number>,
    N: number,
    offset = 0,
  ): { x: number; y: number | null }[] {
    const pct = optPercent.checked;
    const log = optLog.checked;
    const out: { x: number; y: number | null }[] = [];
    for (let i = 0; i < values.length; i++) {
      const raw = values[i] as number;
      const v = pct ? (raw / N) * 100 : raw;
      out.push({ x: times[i + offset] as number, y: log && !(v > 0) ? null : v });
    }
    return out;
  }

  /** Intervention bands for the charts. */
  function bandsOf2(s: Scenario): Band[] {
    return s.interventions.map((iv) => ({
      startDay: iv.startDay,
      endDay: Math.min(iv.endDay, s.params.horizonDays),
      kind: iv.type === 'contact_reduction' ? 'contact' : 'vaccination',
      label:
        iv.type === 'contact_reduction'
          ? `Contacts −${Math.round(iv.strength * 100)}%`
          : `Vaccination ${(iv.strength * 100).toFixed(1)}%/day`,
    }));
  }

  /** Recomputes everything for the live scenario and refreshes all panels. */
  function render(): void {
    const s = store.scenario;
    controls.sync(s);
    timeline.sync(s);
    byId<HTMLButtonElement>('btn-undo').disabled = !store.canUndo;
    byId<HTMLButtonElement>('btn-redo').disabled = !store.canRedo;
    const outcome = runScenario(s);
    const stage = byId('sim-stage');
    const errorBox = byId('sim-error');
    if (!outcome.ok) {
      current = null;
      controls.showIssues(outcome.issues);
      timeline.showIssues(outcome.issues);
      stage.hidden = true;
      errorBox.hidden = false;
      clear(errorBox);
      errorBox.append(
        h('h3', {}, 'Some values need fixing'),
        h('ul', {}, ...outcome.issues.map((i) => h('li', {}, i.message))),
        h(
          'p',
          { class: 'muted small' },
          'The charts and key numbers will appear as soon as the values are valid.',
        ),
      );
      byId('results').hidden = true;
      return;
    }
    controls.showIssues([]);
    timeline.showIssues([]);
    stage.hidden = false;
    errorBox.hidden = true;
    byId('results').hidden = false;
    current = outcome.result;
    const r = outcome.result;
    const N = s.params.population;
    const t = r.trajectory;
    const pct = optPercent.checked;
    const unit = pct ? 'Percent of population' : 'People';
    const yFormat = pct ? 'percent' : 'count';
    const bands = bandsOf2(s);
    const log = optLog.checked;

    // compartments
    const comps = MODEL_INFO[s.params.model].compartments;
    for (const el of compBoxes.querySelectorAll<HTMLElement>('[data-comp]'))
      el.hidden = !comps.includes(el.dataset['comp'] as Compartment); // data-comp holds a compartment id
    const mainSets: SeriesDef[] = comps
      .filter((c) => shown[c])
      .map((c) => ({
        label: COMPARTMENT_NAME[c],
        color: compartmentColor(c),
        dash: COMPARTMENT_DASH[c],
        width: c === 'I' ? 3 : 2,
        data: points(t.times, t[c], N),
      }));
    mainChart.update({
      datasets: mainSets,
      yTitle: unit,
      yFormat,
      log,
      bands,
      ...(log ? { yMin: pct ? 1e-4 : 1 } : {}),
    });
    const compHost = byId('table-main');
    clear(compHost);
    compHost.append(
      dataTable(
        'Show data as a table',
        ['Day', ...comps.map((c) => c)],
        Array.from(t.times, (d, i) => [d, ...comps.map((c) => fmtInt(t[c][i] as number))]),
      ),
    );

    // incidence
    const cumulative = incMode.value === 'cumulative';
    const incVals = cumulative ? t.cumInfections : r.incidence;
    const incTimes = cumulative ? t.times : t.times.subarray(1);
    incChart.update({
      datasets: [
        {
          label: cumulative ? 'Cumulative infections' : 'New infections per day',
          color: cssVar('--c-I'),
          dash: [],
          width: 3,
          data: points(incTimes, incVals, N),
        },
      ],
      yTitle: cumulative
        ? `Cumulative infections (${pct ? '% of population' : 'people'})`
        : `New infections per day (${pct ? '% of population' : 'people'})`,
      yFormat,
      log,
      bands,
      ...(log ? { yMin: pct ? 1e-4 : 1 } : {}),
    });
    const incHost = byId('table-inc');
    clear(incHost);
    incHost.append(
      dataTable(
        'Show data as a table',
        ['Day', 'New infections per day', 'Cumulative infections'],
        Array.from(r.incidence, (v, i) => [
          t.times[i + 1] as number,
          fmtInt(v),
          fmtInt(t.cumInfections[i + 1] as number),
        ]),
      ),
    );

    // R_eff
    const segs: [number, number][] = [];
    let open = -1;
    for (let i = 0; i < r.reff.length; i++) {
      const above = (r.reff[i] as number) > 1;
      if (above && open < 0) open = i;
      if ((!above || i === r.reff.length - 1) && open >= 0) {
        segs.push([t.times[open] as number, t.times[above ? i : i - 1] as number]);
        open = -1;
      }
    }
    reffChart.update({
      datasets: [
        {
          label: 'R_eff (effective reproduction number)',
          color: cssVar('--c-I'),
          dash: [],
          width: 3,
          data: Array.from(r.reff, (v, i) => ({ x: t.times[i] as number, y: v })),
        },
      ],
      yTitle: 'R_eff',
      yFormat: 'plain',
      bands,
      hline: 1,
      shade: { segments: segs, label: 'R_eff > 1: outbreak growing' },
    });
    const reffHost = byId('table-reff');
    clear(reffHost);
    reffHost.append(
      dataTable(
        'Show data as a table',
        ['Day', 'R_eff'],
        Array.from(r.reff, (v, i) => [t.times[i] as number, v.toFixed(3)]),
      ),
    );
    byId('reff-note').textContent =
      segs.length === 0
        ? 'R_eff is never above 1, so the outbreak does not grow.'
        : `Shaded: days when R_eff is above 1 (${segs.map(([a, b]) => `${a}–${b}`).join(', ')}) and each case infects more than one other person.`;

    renderEnsemble(r);
    renderCompareTab(r);
    renderResultsPanel(r);
    byId('status-seed').textContent = `Seed ${s.seed}`;
  }

  /** Key numbers panel; shows stochastic medians when the stochastic tab is open and the ensemble is current. */
  function renderResultsPanel(r: ScenarioResult): void {
    const done = ensembleState.status === 'done' ? ensembleState.result : null;
    const stoch =
      done !== null && activeTab === 'stochastic'
        ? {
            summary: done.summary,
            method: done.method,
            stale: done.key !== scenarioKey(store.scenario),
          }
        : null;
    renderResults(byId('results-body'), r, stoch);
  }

  /** Stochastic tab: state panel, ensemble canvas, fizzle panel and table fallback. */
  function renderEnsemble(r: ScenarioResult): void {
    const s = store.scenario;
    byId('ens-note').textContent =
      `${s.ensembleSize} runs, seed ${s.seed}. Method is chosen automatically: exact Gillespie for populations up to 20,000, chain-binomial steps for larger ones. Initial infected is rounded to a whole number.`;
    const running = ensembleState.status === 'running';
    runBtn.textContent = running ? 'Running…' : 'Run stochastic ensemble';
    runBtn.disabled = running;
    renderState(byId('ens-state'), ensembleState, {
      idleText:
        'Press “Run stochastic ensemble” (or Space) to simulate many random versions of this outbreak.',
      done: (c, d) => {
        const stale = d.key !== scenarioKey(s);
        c.append(
          h(
            'p',
            { class: stale ? 'small warn' : 'small muted' },
            stale
              ? 'These results are for earlier settings. Run the ensemble again to update them.'
              : `Finished ${d.data.count} runs (${d.method === 'gillespie' ? 'exact Gillespie' : 'chain-binomial'}).`,
          ),
        );
      },
      onCancel: () => job?.cancel(),
      onRetry: () => runEnsemble(),
    });
    const done = ensembleState.status === 'done' ? ensembleState.result : null;
    const fizzleBox = byId('ens-fizzle');
    clear(fizzleBox);
    const tableBox = byId('table-ens');
    clear(tableBox);
    if (done === null) {
      ensChart.set(null);
      byId('ens-readout').textContent = '';
      return;
    }
    const series = ensSeries.value === 'cum' ? 'cumInfections' : 'I';
    const N = done.scenario.params.population;
    const pct = optPercent.checked;
    const bands = bandsOf(done.data, series);
    const det = series === 'I' ? r.trajectory.I : r.trajectory.cumInfections;
    ensChart.set({
      times: done.data.times,
      count: done.data.count,
      runs: series === 'I' ? done.data.I : done.data.cumInfections,
      bands,
      deterministic: done.key === scenarioKey(s) ? det : null,
      yLabel:
        series === 'I'
          ? pct
            ? 'Infectious (% of population)'
            : 'Infectious people'
          : pct
            ? 'Cumulative infections (% of population)'
            : 'Cumulative infections',
      scale: pct ? N / 100 : 1,
      percent: pct,
    });
    fizzleBox.append(fizzlePanel(r, { summary: done.summary, method: done.method, stale: false }));
    tableBox.append(
      dataTable(
        'Show data as a table',
        ['Day', 'Median', '50% band low', '50% band high', '95% band low', '95% band high'],
        Array.from(done.data.times, (d, i) => [
          d,
          fmtInt(bands.median[i] as number),
          fmtInt(bands.q25[i] as number),
          fmtInt(bands.q75[i] as number),
          fmtInt(bands.q025[i] as number),
          fmtInt(bands.q975[i] as number),
        ]),
      ),
    );
  }

  /** Starts the ensemble in workers (with progress and cancel). */
  function runEnsemble(): void {
    if (ensembleState.status === 'running') return;
    const s = store.scenario;
    if (validateScenario(s).length > 0) {
      ensembleState = { status: 'error', message: 'Fix the invalid values first, then run again.' };
      schedule();
      return;
    }
    const key = scenarioKey(s);
    ensembleState = { status: 'running', progress: 0 };
    try {
      job = startEnsemble(s, (f) => {
        if (ensembleState.status === 'running') {
          ensembleState = { status: 'running', progress: f };
          renderState(byId('ens-state'), ensembleState, {
            idleText: '',
            done: () => undefined,
            onCancel: () => job?.cancel(),
          });
        }
      });
    } catch (e) {
      ensembleState = {
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not start the workers.',
      };
      schedule();
      return;
    }
    const thisJob = job;
    schedule();
    void thisJob.result.then((o) => {
      if (job !== thisJob) return;
      job = null;
      if (o.status === 'done')
        ensembleState = {
          status: 'done',
          result: {
            data: o.data,
            method: o.method,
            summary: summarizeEnsemble(o.data, s.params.population),
            key,
            scenario: s,
          },
        };
      else if (o.status === 'cancelled') ensembleState = { status: 'cancelled' };
      else ensembleState = { status: 'error', message: `The stochastic run failed: ${o.message}` };
      schedule();
    });
  }

  /** Compare tab: overlay chart and key-number table. */
  function renderCompareTab(r: ScenarioResult): void {
    const entries = [
      { key: 'current', label: 'Current', result: r as ScenarioResult | null },
      ...(['A', 'B', 'C'] as const).map((k) => ({
        key: k,
        label: `Scenario ${k}`,
        result: saved[k],
      })),
    ];
    for (const k of ['A', 'B', 'C'] as const)
      byId(`save-${k}`).textContent = saved[k] ? `Update ${k}` : `Save as ${k}`;
    const sets: SeriesDef[] = [];
    entries.forEach((e, idx) => {
      if (e.result === null || (e.key !== 'current' && !overlay[e.key as 'A' | 'B' | 'C'])) return;
      const style = SCENARIO_STYLES[idx];
      if (!style) return;
      const N = e.result.scenario.params.population;
      sets.push({
        label: `${e.label}: infectious (I)`,
        color: cssVar(style.color),
        dash: [...style.dash],
        width: 3,
        data: points(e.result.trajectory.times, e.result.trajectory.I, N),
      });
    });
    cmpChart.update({
      datasets: sets,
      yTitle: optPercent.checked ? 'Infectious (% of population)' : 'Infectious people',
      yFormat: optPercent.checked ? 'percent' : 'count',
      log: optLog.checked,
      bands: bandsOf2(r.scenario),
      ...(optLog.checked ? { yMin: optPercent.checked ? 1e-4 : 1 } : {}),
    });
    const present = entries.filter((e) => e.result !== null);
    const previous = baselineSel.value;
    clear(baselineSel);
    for (const e of present) baselineSel.append(h('option', { value: e.key }, e.label));
    baselineSel.value =
      baselineChosen && present.some((e) => e.key === previous)
        ? previous
        : (present.find((e) => e.key !== 'current')?.key ?? 'current');
    renderCompare(byId('compare-root'), entries, baselineSel.value);
  }

  // ---- store wiring
  store.subscribe(() => schedule());
  byId('btn-undo').addEventListener('click', () => store.undo());
  byId('btn-redo').addEventListener('click', () => store.redo());

  // ---- file and export operations
  /** Reports the result of a save dialog to the user. */
  async function saveText(
    kind: 'scenario' | 'csv',
    defaultName: string,
    data: string,
    what: string,
  ): Promise<void> {
    const res = await api.saveFile({ kind, defaultName, data, encoding: 'utf8' });
    if (res.ok) notify(`${what} saved as ${res.name}.`);
    else if (res.reason !== 'cancelled') notify(res.message, 'error');
  }

  selectTab('compartments');
  schedule();

  return {
    redraw: () => schedule(),
    async saveScenarioFile() {
      await saveText(
        'scenario',
        'outbreakscope-scenario.json',
        serializeScenario(store.scenario, appVersion()),
        'Scenario',
      );
    },
    async openScenarioFile() {
      const res = await api.openFile({ kind: 'scenario' });
      if (!res.ok) {
        if (res.reason !== 'cancelled') notify(res.message, 'error');
        return;
      }
      const parsed = parseScenarioFile(res.text);
      if (!parsed.ok) {
        notify(parsed.message, 'error');
        return;
      }
      store.commit(parsed.scenario);
      ensembleState = { status: 'idle' };
      notify(`Opened ${res.name} (saved by OutbreakScope ${parsed.appVersion}).`);
    },
    async exportCsv() {
      const fresh = runScenario(store.scenario);
      if (!fresh.ok) {
        notify('Nothing to export: fix the invalid values first.', 'error');
        return;
      }
      const done = ensembleState.status === 'done' ? ensembleState.result : null;
      if (activeTab === 'stochastic' && done !== null) {
        await saveText(
          'csv',
          'outbreakscope-ensemble.csv',
          ensembleCsv(
            done.scenario,
            done.data.times,
            bandsOf(done.data, 'I'),
            appVersion(),
            done.method,
          ),
          'Ensemble CSV',
        );
      } else {
        await saveText(
          'csv',
          'outbreakscope-timeseries.csv',
          deterministicCsv(fresh.result, appVersion()),
          'CSV',
        );
      }
    },
    async exportPng() {
      const chart =
        activeTab === 'compartments'
          ? mainChart
          : activeTab === 'incidence'
            ? incChart
            : activeTab === 'reff'
              ? reffChart
              : activeTab === 'compare'
                ? cmpChart
                : null;
      const data = chart ? chart.toPngBase64() : ensChart.toPngBase64();
      const res = await api.saveFile({
        kind: 'png',
        defaultName: `outbreakscope-${activeTab}.png`,
        data,
        encoding: 'base64',
      });
      if (res.ok) notify(`Chart saved as ${res.name}.`);
      else if (res.reason !== 'cancelled') notify(res.message, 'error');
    },
    toggleRun() {
      if (ensembleState.status === 'running') job?.cancel();
      else {
        selectTab('stochastic');
        runEnsemble();
      }
    },
  };
}

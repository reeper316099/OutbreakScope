// Left control panel: model selector, preset dropdown, parameter sliders + numeric fields, seed and ensemble size.
import type { ModelKind, Scenario, UserParams } from '../shared/types';
import { MODEL_INFO } from '../sim/models';
import { PRESETS } from '../sim/presets';
import type { Preset, PresetValue } from '../sim/presets';
import type { ParamError } from '../sim/errors';
import { clear, h } from './dom';
import type { ScenarioStore } from './store';

interface FieldSpec {
  key: keyof UserParams | 'seed' | 'ensembleSize';
  label: string;
  unit: string;
  tip: string;
  min: number;
  max: number;
  step: number;
  /** Slider uses a log10 scale (population, initial infected). */
  log?: boolean;
  /** Only show for these models. */
  models?: ModelKind[];
  integer?: boolean;
}

const FIELDS: FieldSpec[] = [
  {
    key: 'r0',
    label: 'R0 (reproduction number)',
    unit: '',
    tip: 'R0: the average number of people one infectious person infects in a fully susceptible population.',
    min: 0,
    max: 20,
    step: 0.05,
  },
  {
    key: 'incubationDays',
    label: 'Incubation period',
    unit: 'days',
    tip: 'Average days from catching the infection to becoming infectious (the exposed stage).',
    min: 0.5,
    max: 30,
    step: 0.1,
    models: ['SEIR', 'SEIRV'],
  },
  {
    key: 'infectiousDays',
    label: 'Infectious period',
    unit: 'days',
    tip: 'Average days a person stays infectious before recovering.',
    min: 0.5,
    max: 30,
    step: 0.1,
  },
  {
    key: 'population',
    label: 'Population size',
    unit: 'people',
    tip: 'Total number of people, N. Assumed constant (no births, deaths or travel).',
    min: 100,
    max: 1e9,
    step: 1,
    log: true,
    integer: true,
  },
  {
    key: 'initialInfected',
    label: 'Initially infectious',
    unit: 'people',
    tip: 'How many people are infectious on day 0.',
    min: 1,
    max: 10000,
    step: 1,
    log: true,
    integer: true,
  },
  {
    key: 'vaccineEfficacy',
    label: 'Vaccine efficacy',
    unit: '0–1',
    tip: 'How much a vaccine lowers a vaccinated person’s chance of infection (0 = none, 1 = full protection). Used by vaccination campaigns in the SEIR + vaccination model.',
    min: 0,
    max: 1,
    step: 0.01,
    models: ['SEIRV'],
  },
  {
    key: 'horizonDays',
    label: 'Simulation length',
    unit: 'days',
    tip: 'How many days to simulate.',
    min: 30,
    max: 1095,
    step: 1,
    integer: true,
  },
  {
    key: 'seed',
    label: 'Random seed',
    unit: 'integer',
    tip: 'Seed for the random number generator in stochastic runs. The same seed and settings always give the same random runs.',
    min: 0,
    max: 4294967295,
    step: 1,
    integer: true,
  },
  {
    key: 'ensembleSize',
    label: 'Stochastic runs',
    unit: 'runs',
    tip: 'How many random realizations to simulate in stochastic mode (default 100, up to 1000).',
    min: 1,
    max: 1000,
    step: 1,
    integer: true,
  },
];

interface FieldHandle {
  spec: FieldSpec;
  row: HTMLElement;
  slider: HTMLInputElement | null;
  input: HTMLInputElement;
  error: HTMLElement;
}

/** Reads the current value of a field from a scenario. */
function readValue(s: Scenario, key: FieldSpec['key']): number {
  if (key === 'seed') return s.seed;
  if (key === 'ensembleSize') return s.ensembleSize;
  const v = s.params[key];
  return typeof v === 'number' ? v : NaN;
}

/** Returns a copy of the scenario with one numeric field changed. */
function withValue(s: Scenario, key: FieldSpec['key'], value: number): Scenario {
  if (key === 'seed') return { ...s, seed: value };
  if (key === 'ensembleSize') return { ...s, ensembleSize: value };
  if (key === 'model') return s;
  return { ...s, params: { ...s.params, [key]: value } };
}

export interface ControlsPanel {
  /** Updates every control to show the scenario (called on undo, load, preset, ...). */
  sync(s: Scenario): void;
  /** Shows validation messages next to the fields they belong to. */
  showIssues(issues: ParamError[]): void;
}

/** Builds the control panel inside `root` and wires it to the store. */
export function buildControls(
  root: HTMLElement,
  store: ScenarioStore,
  openExternal: (url: string) => void,
): ControlsPanel {
  clear(root);
  const handles: FieldHandle[] = [];

  // --- model selector with one-line descriptions
  const modelSelect = h('select', { id: 'model-select', 'aria-label': 'Model' });
  for (const [kind, info] of Object.entries(MODEL_INFO))
    modelSelect.append(h('option', { value: kind }, info.label));
  const modelDesc = h('p', { class: 'muted small', id: 'model-desc' });
  modelSelect.addEventListener('change', () => {
    const s = store.scenario;
    const model = modelSelect.value as ModelKind; // option values come from MODEL_INFO keys
    const interventions =
      model === 'SEIRV'
        ? s.interventions
        : s.interventions.filter((iv) => iv.type !== 'vaccination');
    store.commit({ ...s, params: { ...s.params, model }, interventions });
  });

  // --- presets
  const presetSelect = h(
    'select',
    { id: 'preset-select', 'aria-label': 'Disease preset' },
    h('option', { value: '' }, 'Custom values'),
  );
  for (const p of PRESETS) presetSelect.append(h('option', { value: p.id }, p.name));
  const presetInfo = h('div', { class: 'preset-info small', id: 'preset-info' });
  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === presetSelect.value);
    renderPresetInfo(presetInfo, preset, openExternal);
    if (preset === undefined) return;
    const s = store.scenario;
    const interventions =
      preset.model === 'SEIRV'
        ? s.interventions
        : s.interventions.filter((iv) => iv.type !== 'vaccination');
    store.commit({
      ...s,
      interventions,
      params: {
        ...s.params,
        model: preset.model,
        r0: preset.r0.value,
        incubationDays: preset.incubationDays?.value ?? s.params.incubationDays,
        infectiousDays: preset.infectiousDays.value,
      },
    });
  });

  root.append(
    h('h2', {}, 'Model'),
    h('label', { class: 'field-label', for: 'model-select' }, 'Which model?'),
    modelSelect,
    modelDesc,
    h('label', { class: 'field-label', for: 'preset-select' }, 'Illustrative preset'),
    presetSelect,
    presetInfo,
    h('h2', {}, 'Parameters'),
  );

  for (const spec of FIELDS) {
    if (spec.key === 'seed') root.append(h('h2', {}, 'Randomness'));
    const handle = buildField(spec, store);
    handles.push(handle);
    root.append(handle.row);
    if (spec.key === 'seed') {
      const rand = h(
        'button',
        {
          type: 'button',
          class: 'btn small-btn',
          id: 'btn-randomize',
          'aria-label': 'Pick a new random seed',
        },
        'New seed',
      );
      rand.addEventListener('click', () => {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf); // only used to choose a seed; simulations then use the seeded PRNG
        store.commit(withValue(store.scenario, 'seed', buf[0] ?? 1));
      });
      root.append(rand);
    }
  }

  return {
    sync(s) {
      modelSelect.value = s.params.model;
      modelDesc.textContent = MODEL_INFO[s.params.model].description;
      const chosen = PRESETS.find((p) => p.id === presetSelect.value);
      if (chosen !== undefined && !matchesPreset(s, chosen)) {
        presetSelect.value = ''; // the user changed a value by hand: no longer exactly the preset
        clear(presetInfo);
      }
      for (const hd of handles) {
        const visible = hd.spec.models === undefined || hd.spec.models.includes(s.params.model);
        hd.row.hidden = !visible;
        const v = readValue(s, hd.spec.key);
        if (document.activeElement !== hd.input)
          hd.input.value = Number.isFinite(v) ? String(v) : '';
        if (hd.slider && document.activeElement !== hd.slider)
          hd.slider.value = String(toSlider(hd.spec, v));
      }
    },
    showIssues(issues) {
      for (const hd of handles) {
        const msgs = issues.filter((i) => i.field === hd.spec.key).map((i) => i.message);
        hd.error.textContent = msgs.join(' ');
        hd.input.setAttribute('aria-invalid', msgs.length > 0 ? 'true' : 'false');
      }
    },
  };
}

/** True if the scenario's disease parameters are exactly the preset's. */
function matchesPreset(s: Scenario, p: Preset): boolean {
  const q = s.params;
  return (
    q.model === p.model &&
    q.r0 === p.r0.value &&
    q.infectiousDays === p.infectiousDays.value &&
    (p.incubationDays === null || q.incubationDays === p.incubationDays.value)
  );
}

/** Maps a field value to its slider position (log10 for log sliders). */
function toSlider(spec: FieldSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.min;
  return spec.log ? Math.log10(Math.max(value, spec.min)) : value;
}

/** Maps a slider position back to a field value. */
function fromSlider(spec: FieldSpec, pos: number): number {
  const raw = spec.log ? Math.pow(10, pos) : pos;
  const rounded = spec.integer ? Math.round(raw) : Math.round(raw / spec.step) * spec.step;
  return Number(rounded.toPrecision(10));
}

/** Builds one labelled field: slider + numeric box + unit + tooltip + error line. */
function buildField(spec: FieldSpec, store: ScenarioStore): FieldHandle {
  const id = `f-${spec.key}`;
  const hasSlider = spec.key !== 'seed';
  const input = h('input', {
    type: 'number',
    id,
    class: 'num',
    step: spec.integer ? 1 : 'any',
    'aria-label': `${spec.label} (${spec.unit})`,
  });
  const error = h('div', { class: 'field-error small', id: `${id}-err`, role: 'alert' });
  input.setAttribute('aria-describedby', `${id}-err`);
  let slider: HTMLInputElement | null = null;
  if (hasSlider) {
    slider = h('input', {
      type: 'range',
      class: 'slider',
      id: `${id}-slider`,
      min: spec.log ? Math.log10(spec.min) : spec.min,
      max: spec.log ? Math.log10(spec.max) : spec.max,
      step: spec.log ? 0.01 : spec.step,
      'aria-label': `${spec.label} slider`,
    });
    const slide = slider;
    slide.addEventListener('input', () => {
      const v = fromSlider(spec, Number(slide.value));
      input.value = String(v);
      store.preview(withValue(store.scenario, spec.key, v));
    });
    slide.addEventListener('change', () =>
      store.commit(withValue(store.scenario, spec.key, fromSlider(spec, Number(slide.value)))),
    );
  }
  input.addEventListener('input', () => {
    const v = input.valueAsNumber;
    if (!Number.isNaN(v)) store.preview(withValue(store.scenario, spec.key, v));
    else store.preview(withValue(store.scenario, spec.key, NaN));
  });
  input.addEventListener('change', () => {
    const v = input.valueAsNumber;
    store.commit(
      withValue(store.scenario, spec.key, Number.isNaN(v) ? NaN : spec.integer ? Math.round(v) : v),
    );
  });
  const tip = h(
    'span',
    {
      class: 'tip',
      tabindex: 0,
      role: 'note',
      'data-tip': spec.tip,
      'aria-label': `About ${spec.label}: ${spec.tip}`,
    },
    '?',
  );
  const row = h(
    'div',
    { class: 'field', 'data-field': spec.key },
    h(
      'div',
      { class: 'field-head' },
      h('label', { for: id, class: 'field-label' }, spec.label),
      tip,
    ),
    h('div', { class: 'field-body' }, slider, input, h('span', { class: 'unit' }, spec.unit)),
    error,
  );
  return { spec, row, slider, input, error };
}

/** Describes a preset value with its range and whether it was reported, derived or assumed. */
function describeValue(label: string, v: PresetValue | null, unit: string): HTMLElement | null {
  if (v === null) return null;
  const range = v.low === v.high ? '' : ` (plausible range ${v.low}–${v.high})`;
  return h(
    'li',
    {},
    `${label}: ${v.value}${unit}${range} – ${v.kind}. `,
    h('span', { class: 'muted' }, v.how),
  );
}

/** Shows the source, ranges and caveat of the chosen preset, with links opened through the allowlisted bridge. */
function renderPresetInfo(
  box: HTMLElement,
  preset: Preset | undefined,
  openExternal: (url: string) => void,
): void {
  clear(box);
  if (preset === undefined) return;
  const links = preset.sources.map((s) => {
    const a = h('a', { href: s.url, class: 'ext-link' }, s.label);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openExternal(s.url);
    });
    return h('li', {}, a);
  });
  box.append(
    h(
      'p',
      { class: 'small' },
      'Illustrative values from the literature – not predictions about any current outbreak.',
    ),
    h(
      'ul',
      { class: 'small' },
      describeValue('R0', preset.r0, ''),
      describeValue('Incubation', preset.incubationDays, ' days'),
      describeValue('Infectious period', preset.infectiousDays, ' days'),
    ),
    h('p', { class: 'small muted' }, `Ranges: ${preset.rangeBasis}.`),
    h('p', { class: 'small' }, preset.caveat),
    preset.sources.length > 0
      ? h('ul', { class: 'small' }, ...links)
      : h('p', { class: 'small' }, 'No source: hypothetical teaching values.'),
  );
}

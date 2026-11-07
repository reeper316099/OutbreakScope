// Intervention timeline editor: add/edit/remove events, with an SVG strip showing where they fall.
import type { Intervention, Scenario } from '../shared/types';
import type { ParamError } from '../sim/errors';
import { clear, h, svg } from './dom';
import type { ScenarioStore } from './store';

export interface TimelinePanel {
  /** Redraws the editor for the scenario. */
  sync(s: Scenario): void;
  /** Shows validation messages next to the events they belong to. */
  showIssues(issues: ParamError[]): void;
}

/** Builds the intervention editor inside `root`. */
export function buildTimeline(root: HTMLElement, store: ScenarioStore): TimelinePanel {
  const strip = h('div', { class: 'timeline-strip', id: 'timeline-strip' });
  const list = h('div', { class: 'event-list', id: 'event-list' });
  const addContact = h(
    'button',
    { type: 'button', class: 'btn small-btn', id: 'btn-add-contact' },
    '+ Contact reduction',
  );
  const addVax = h(
    'button',
    { type: 'button', class: 'btn small-btn', id: 'btn-add-vax' },
    '+ Vaccination campaign',
  );
  const help = h(
    'p',
    { class: 'small muted' },
    'Events are active from the start day up to (not including) the end day. Overlaps: contact reductions multiply (two 50% cuts leave 25% of contacts); vaccination rates add up.',
  );
  root.append(
    h('h2', {}, 'Interventions'),
    strip,
    list,
    h('div', { class: 'row-gap' }, addContact, addVax),
    help,
  );

  addContact.addEventListener('click', () => {
    const s = store.scenario;
    const start = Math.min(30, Math.floor(s.params.horizonDays / 3));
    store.commit({
      ...s,
      interventions: [
        ...s.interventions,
        { type: 'contact_reduction', startDay: start, endDay: s.params.horizonDays, strength: 0.4 },
      ],
    });
  });
  addVax.addEventListener('click', () => {
    const s = store.scenario;
    const start = Math.min(45, Math.floor(s.params.horizonDays / 3));
    store.commit({
      ...s,
      interventions: [
        ...s.interventions,
        {
          type: 'vaccination',
          startDay: start,
          endDay: Math.min(start + 45, s.params.horizonDays),
          strength: 0.01,
        },
      ],
    });
  });

  let lastIssues: ParamError[] = [];

  /** Draws the whole panel for a scenario. */
  function render(s: Scenario): void {
    addVax.disabled = s.params.model !== 'SEIRV';
    addVax.title =
      s.params.model === 'SEIRV'
        ? ''
        : 'Choose the SEIR + vaccination model to add vaccination campaigns.';
    drawStrip(strip, s);
    clear(list);
    if (s.interventions.length === 0)
      list.append(
        h(
          'p',
          { class: 'muted small', 'data-state': 'empty' },
          'No interventions yet. Add one to see how it changes the curve.',
        ),
      );
    s.interventions.forEach((iv, i) => list.append(eventRow(iv, i, s, store, lastIssues)));
  }

  return {
    sync: render,
    showIssues(issues) {
      lastIssues = issues;
      render(store.scenario);
    },
  };
}

/** One editable row for an event. */
function eventRow(
  iv: Intervention,
  index: number,
  s: Scenario,
  store: ScenarioStore,
  issues: ParamError[],
): HTMLElement {
  const isContact = iv.type === 'contact_reduction';
  const mk = (
    label: string,
    value: number,
    apply: (v: number) => Intervention,
    scale = 1,
  ): HTMLElement => {
    const input = h('input', {
      type: 'number',
      class: 'num small-num',
      value: Number((value * scale).toPrecision(8)),
      step: 'any',
      'aria-label': `${isContact ? 'Contact reduction' : 'Vaccination'} ${index + 1}: ${label}`,
    });
    input.addEventListener('change', () => {
      const v = input.valueAsNumber;
      const next = s.interventions.map((x, j) =>
        j === index ? apply(Number.isNaN(v) ? NaN : v / scale) : x,
      );
      store.commit({ ...s, interventions: next });
    });
    return h('label', { class: 'mini' }, h('span', { class: 'small muted' }, label), input);
  };
  const remove = h(
    'button',
    { type: 'button', class: 'btn small-btn', 'aria-label': `Remove event ${index + 1}` },
    'Remove',
  );
  remove.addEventListener('click', () =>
    store.commit({ ...s, interventions: s.interventions.filter((_, j) => j !== index) }),
  );
  const msgs = issues.filter((e) => e.field === `interventions[${index}]`).map((e) => e.message);
  return h(
    'div',
    { class: `event ${isContact ? 'ev-contact' : 'ev-vax'}`, 'data-index': index },
    h(
      'div',
      { class: 'event-title' },
      h('strong', {}, isContact ? 'Contact reduction' : 'Vaccination campaign'),
      remove,
    ),
    h(
      'div',
      { class: 'event-fields' },
      mk('start day', iv.startDay, (v) => ({ ...iv, startDay: v })),
      mk('end day', iv.endDay, (v) => ({ ...iv, endDay: v })),
      mk(
        isContact ? 'contacts removed (%)' : 'of susceptibles per day (%)',
        iv.strength,
        (v) => ({ ...iv, strength: v }),
        100,
      ),
    ),
    h('div', { class: 'field-error small', role: 'alert' }, msgs.join(' ')),
  );
}

/** Draws a small SVG timeline strip with one coloured bar per event. */
function drawStrip(box: HTMLElement, s: Scenario): void {
  clear(box);
  const W = 280;
  const rowH = 10;
  const H = Math.max(26, 18 + s.interventions.length * (rowH + 2));
  const horizon = Math.max(1, s.params.horizonDays);
  const x = (day: number): number => 4 + (Math.min(Math.max(day, 0), horizon) / horizon) * (W - 8);
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': `Timeline of ${s.interventions.length} interventions over ${horizon} days`,
  });
  root.append(svg('line', { x1: 4, y1: 12, x2: W - 4, y2: 12, class: 'tl-axis' }));
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const t = svg('text', {
      x: x(frac * horizon),
      y: 9,
      class: 'tl-tick',
      'text-anchor': frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle',
    });
    t.textContent = String(Math.round(frac * horizon));
    root.append(t);
  }
  s.interventions.forEach((iv, i) => {
    const w = Math.max(2, x(iv.endDay) - x(iv.startDay));
    root.append(
      svg('rect', {
        x: x(iv.startDay),
        y: 16 + i * (rowH + 2),
        width: w,
        height: rowH,
        rx: 3,
        class: iv.type === 'contact_reduction' ? 'tl-contact' : 'tl-vax',
      }),
    );
  });
  box.append(root);
}

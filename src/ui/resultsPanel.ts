// Key-numbers panel: each number has a one-line explanation; stochastic runs show medians with 95% intervals.
import type { EnsembleSummary } from '../sim/ensemble';
import { theoreticalMajorProbability } from '../sim/ensemble';
import type { ScenarioResult } from '../sim/scenario';
import { MAJOR_OUTBREAK_FRACTION } from '../sim/stochastic';
import { clear, h } from './dom';
import { fmtDays, fmtInt, fmtPct, fmtSig } from './format';

export const ASSUMPTIONS: readonly string[] = [
  'Everyone mixes equally (homogeneous mixing): no age groups, households, places or travel.',
  'The population size is fixed: no births, deaths or migration.',
  'People who recover are immune for the whole simulation (no waning immunity, no reinfection).',
  'Waiting times in each stage are exponential, which is simpler than real disease timing.',
  'Parameters are constant except for the interventions you add (changes in behaviour or testing are not modelled).',
  'A vaccine is "leaky": it lowers, but does not remove, the chance of infection, takes effect immediately and never wears off; doses go only to susceptible people.',
  'These are teaching models, not forecasts. Do not use them for public-health decisions.',
];

interface Card {
  title: string;
  value: string;
  note: string;
  /** Extra detail line (e.g. 95% interval). */
  detail?: string;
}

/** Builds one card element. */
function card(c: Card): HTMLElement {
  return h(
    'div',
    { class: 'stat', 'data-stat': c.title },
    h('div', { class: 'stat-title' }, c.title),
    h('div', { class: 'stat-value' }, c.value),
    c.detail ? h('div', { class: 'stat-detail small' }, c.detail) : null,
    h('div', { class: 'stat-note small muted' }, c.note),
  );
}

/** Deterministic key numbers for one scenario. */
function deterministicCards(r: ScenarioResult): Card[] {
  const n = r.numbers;
  const N = r.scenario.params.population;
  const cards: Card[] = [
    {
      title: 'Peak infectious',
      value: fmtInt(n.peakInfectious),
      detail: `${fmtPct(n.peakInfectious / N)} of the population`,
      note: 'The most people infectious at the same time.',
    },
    { title: 'Peak day', value: `day ${fmtSig(n.peakDay, 3)}`, note: 'When that maximum happens.' },
    {
      title: 'Final size',
      value: fmtPct(n.attackRate),
      detail: n.stillOngoing
        ? 'Still growing at the end of the window'
        : `Plain outbreak with this R0 would reach ${fmtPct(n.analyticFinalSize)}`,
      note: 'Share of people who were ever infected.',
    },
    {
      title: 'Herd immunity threshold',
      value: fmtPct(n.herdImmunityThreshold),
      note: 'Immune share (1 − 1/R0) above which each case infects fewer than one other.',
    },
    {
      title: 'Early growth rate',
      value: `${fmtSig(n.growthRate, 3)} per day`,
      note: 'How fast cases grow at the start (negative means shrinking).',
    },
    {
      title: n.doublingTimeDays !== null ? 'Doubling time' : 'Halving time',
      value: fmtDays(n.doublingTimeDays ?? n.halvingTimeDays),
      note:
        n.doublingTimeDays !== null
          ? 'Days for early cases to double.'
          : 'Days for early cases to halve (R0 below 1).',
    },
    { title: 'R0', value: fmtSig(n.r0, 3), note: 'Basic reproduction number you chose.' },
    {
      title: 'R_eff now',
      value: `${fmtSig(n.reffStart, 3)} → ${fmtSig(n.reffEnd, 3)}`,
      detail: n.growthWindow
        ? `Above 1 from day ${n.growthWindow.startDay} to ${n.growthWindow.endDay}`
        : 'Never above 1',
      note: 'Effective reproduction number at day 0 and at the end; below 1 means the outbreak shrinks.',
    },
  ];
  if (r.scenario.params.model === 'SEIRV')
    cards.push({
      title: 'Total vaccinated',
      value: fmtInt(n.totalVaccinated),
      detail: `${fmtPct(n.totalVaccinated / N)} of the population`,
      note: 'Doses given to susceptible people.',
    });
  return cards;
}

/** Formats a median with its 95% range. */
function range(
  i: { median: number; low: number; high: number } | null,
  f: (x: number) => string,
): { value: string; detail: string } {
  return i === null
    ? { value: 'n/a', detail: 'No major outbreaks in these runs' }
    : { value: f(i.median), detail: `95% of runs: ${f(i.low)} – ${f(i.high)}` };
}

/** Stochastic cards (medians over major outbreaks, plus the overall fizzle fraction). */
function stochasticCards(r: ScenarioResult, s: EnsembleSummary): Card[] {
  const N = r.scenario.params.population;
  const peak = range(s.peakInfectious, fmtInt);
  const day = range(s.peakDay, (x) => `day ${fmtSig(x, 3)}`);
  const size = range(s.finalSizeFraction, fmtPct);
  return [
    {
      title: 'Peak infectious (median)',
      value: peak.value,
      detail: peak.detail,
      note: `Among major outbreaks only (${fmtPct(s.fractionMajor)} of ${s.count} runs).`,
    },
    {
      title: 'Peak day (median)',
      value: day.value,
      detail: day.detail,
      note: 'Timing varies a lot between random runs.',
    },
    {
      title: 'Final size (median)',
      value: size.value,
      detail: size.detail,
      note: 'Share ever infected, among major outbreaks.',
    },
    {
      title: 'Final size, all runs',
      value: fmtPct(s.finalSizeFractionAll.median),
      detail: `95% of runs: ${fmtPct(s.finalSizeFractionAll.low)} – ${fmtPct(s.finalSizeFractionAll.high)}`,
      note: `Includes runs that fizzled out (population ${fmtInt(N)}).`,
    },
  ];
}

export interface StochasticInfo {
  summary: EnsembleSummary;
  method: string;
  stale: boolean;
}

/** Renders the results panel (deterministic numbers or stochastic medians) into `root`. */
export function renderResults(
  root: HTMLElement,
  result: ScenarioResult,
  stochastic: StochasticInfo | null,
): void {
  clear(root);
  const useStoch = stochastic !== null && !stochastic.stale;
  const cards = useStoch ? stochasticCards(result, stochastic.summary) : deterministicCards(result);
  root.append(h('div', { class: 'stats' }, ...cards.map(card)));
  if (stochastic?.stale)
    root.append(
      h(
        'p',
        { class: 'small warn' },
        'The stochastic results are out of date because you changed the scenario. Run the ensemble again.',
      ),
    );
  root.append(
    h(
      'details',
      { class: 'assumptions', open: true },
      h('summary', {}, 'Model assumptions'),
      h('ul', { class: 'small' }, ...ASSUMPTIONS.map((a) => h('li', {}, a))),
    ),
  );
}

/** Panel reporting fizzled vs major outbreaks next to the theoretical expectation, with the definition used. */
export function fizzlePanel(result: ScenarioResult, info: StochasticInfo): HTMLElement {
  const p = result.scenario.params;
  const k = Math.max(1, Math.round(p.initialInfected));
  const theory = theoreticalMajorProbability(p.r0, k);
  const plain = result.scenario.interventions.length === 0;
  return h(
    'div',
    { class: 'fizzle', id: 'fizzle-panel' },
    h('h3', {}, 'Did the outbreak take off?'),
    h(
      'p',
      {},
      h('strong', {}, fmtPct(info.summary.fractionFizzled)),
      ' of runs fizzled out; ',
      h('strong', {}, fmtPct(info.summary.fractionMajor)),
      ' became major outbreaks.',
    ),
    plain
      ? h(
          'p',
          { class: 'small' },
          `Theory (branching-process approximation): chance of a major outbreak ≈ 1 − (1/R0)^${k} = ${fmtPct(theory)}, so ${fmtPct(1 - theory)} expected to fizzle. Accurate for large populations and a plain outbreak.`,
        )
      : h(
          'p',
          { class: 'small muted' },
          'The theoretical value 1 − (1/R0)^k assumes no interventions, so it is not shown for this scenario.',
        ),
    h(
      'p',
      { class: 'small muted' },
      `Definition used: a run is a "major outbreak" if the infections beyond the initial ones reach ${MAJOR_OUTBREAK_FRACTION * 100}% of the population. Method: ${info.method === 'gillespie' ? 'exact Gillespie algorithm (small population)' : 'chain-binomial steps (large population)'}.`,
    ),
  );
}

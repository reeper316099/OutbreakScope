// Scenario comparison table: key numbers side by side, differences from a baseline highlighted (and marked with text).
import type { ScenarioResult } from '../sim/scenario';
import { describeDifference } from '../sim/scenario';
import { clear, h } from './dom';
import { fmtDays, fmtInt, fmtPct, fmtSig } from './format';

export interface CompareEntry {
  key: string;
  label: string;
  result: ScenarioResult | null;
}

interface Row {
  label: string;
  value: (r: ScenarioResult) => number | null;
  show: (r: ScenarioResult) => string;
}

const ROWS: Row[] = [
  {
    label: 'Peak infectious',
    value: (r) => r.numbers.peakInfectious,
    show: (r) => fmtInt(r.numbers.peakInfectious),
  },
  {
    label: 'Peak day',
    value: (r) => r.numbers.peakDay,
    show: (r) => `day ${fmtSig(r.numbers.peakDay, 3)}`,
  },
  {
    label: 'Final size (ever infected)',
    value: (r) => r.numbers.attackRate,
    show: (r) => fmtPct(r.numbers.attackRate),
  },
  {
    label: 'Herd immunity threshold',
    value: (r) => r.numbers.herdImmunityThreshold,
    show: (r) => fmtPct(r.numbers.herdImmunityThreshold),
  },
  {
    label: 'Early growth rate (per day)',
    value: (r) => r.numbers.growthRate,
    show: (r) => fmtSig(r.numbers.growthRate, 3),
  },
  {
    label: 'Doubling time',
    value: (r) => r.numbers.doublingTimeDays,
    show: (r) => fmtDays(r.numbers.doublingTimeDays),
  },
  {
    label: 'R_eff at the end',
    value: (r) => r.numbers.reffEnd,
    show: (r) => fmtSig(r.numbers.reffEnd, 3),
  },
];

/** Renders the comparison table; `baselineKey` is the column others are compared to. */
export function renderCompare(
  root: HTMLElement,
  entries: CompareEntry[],
  baselineKey: string,
): void {
  clear(root);
  const present = entries.filter((e) => e.result !== null);
  if (present.length < 2) {
    root.append(
      h(
        'p',
        { class: 'muted', 'data-state': 'empty' },
        'Save the current setup as Scenario A, B or C, change something (for example add an intervention), then save again to compare them here.',
      ),
    );
    return;
  }
  const base = present.find((e) => e.key === baselineKey)?.result ?? present[0]?.result ?? null;
  if (base === null) return;
  const head = h(
    'tr',
    {},
    h('th', { scope: 'col' }, 'Key number'),
    ...present.map((e) => h('th', { scope: 'col' }, e.label)),
  );
  const body = ROWS.map((row) => {
    const bv = row.value(base);
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, row.label),
      ...present.map((e) => {
        const r = e.result;
        if (r === null) return h('td', {}, '–');
        const v = row.value(r);
        const differs =
          bv !== null &&
          v !== null &&
          Math.abs(v - bv) > 0.005 * Math.max(Math.abs(bv), 1e-12) &&
          r !== base;
        const arrow = differs && v !== null && bv !== null ? (v > bv ? ' ▲' : ' ▼') : '';
        return h(
          'td',
          { class: differs ? 'diff' : '', title: differs ? 'Differs from the baseline' : '' },
          row.show(r),
          arrow
            ? h(
                'span',
                {
                  'aria-label':
                    v !== null && bv !== null && v > bv
                      ? 'higher than baseline'
                      : 'lower than baseline',
                },
                arrow,
              )
            : null,
        );
      }),
    );
  });
  const summary = present
    .filter((e) => e.result !== base && e.result !== null)
    .map((e) =>
      h(
        'li',
        {},
        h('strong', {}, `${e.label}: `),
        e.result ? describeDifference(base.numbers, e.result.numbers) : '',
      ),
    );
  root.append(
    h(
      'table',
      { class: 'compare-table', id: 'compare-table' },
      h('thead', {}, head),
      h('tbody', {}, ...body),
    ),
    h(
      'p',
      { class: 'small muted' },
      `Differences are measured against ${present.find((e) => e.result === base)?.label ?? 'the baseline'}. ▲/▼ mark values more than 0.5% higher/lower.`,
    ),
    h('ul', { class: 'small', id: 'compare-summary' }, ...summary),
  );
}

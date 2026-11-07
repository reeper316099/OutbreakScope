// Text-table fallback for charts (screen readers and anyone who prefers numbers).
import { h } from './dom';

/** Builds a collapsible <details> with a table; rows are sampled so the table stays short. */
export function dataTable(
  summary: string,
  headers: string[],
  rows: (string | number)[][],
  maxRows = 60,
): HTMLElement {
  const step = Math.max(1, Math.ceil(rows.length / maxRows));
  const sampled = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const table = h(
    'table',
    { class: 'data-table' },
    h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...sampled.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, String(c)))))),
  );
  return h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, summary),
    h('div', { class: 'table-scroll' }, table),
  );
}

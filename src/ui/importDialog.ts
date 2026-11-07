// CSV import panel: problems list, column mapping, interval choice and a short preview. Nothing is hidden: every problem is shown.
import type { ColumnMapping, ParsedCsv } from '../io/csv';
import type { ImportProblem } from '../shared/types';
import { clear, h } from './dom';

export interface ImportPanelOptions {
  onMappingChange: (mapping: ColumnMapping) => void;
}

/** Renders problems (errors first), the column mapping controls and a preview of the first rows into `root`. */
export function renderImportPanel(
  root: HTMLElement,
  table: ParsedCsv | null,
  mapping: ColumnMapping,
  problems: ImportProblem[],
  opts: ImportPanelOptions,
): void {
  clear(root);
  if (table === null) return;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...problems].sort((a, b) => order[a.severity] - order[b.severity]);
  root.append(h('h3', {}, 'What I found in the file'));
  if (sorted.length === 0) root.append(h('p', { class: 'small muted' }, 'No problems found.'));
  else {
    root.append(
      h(
        'ul',
        { class: 'problems', id: 'import-problems' },
        ...sorted.map((p) =>
          h(
            'li',
            { class: `prob prob-${p.severity}` },
            h(
              'strong',
              {},
              p.severity === 'error'
                ? 'Problem: '
                : p.severity === 'warning'
                  ? 'Check: '
                  : 'Note: ',
            ),
            p.line !== null ? `line ${p.line}: ` : '',
            p.message,
          ),
        ),
      ),
    );
  }
  const colSelect = (
    label: string,
    value: number | null,
    allowNone: boolean,
    apply: (v: number | null) => void,
    id: string,
  ): HTMLElement => {
    const sel = h('select', { id, 'aria-label': label });
    if (allowNone) sel.append(h('option', { value: '' }, '(use row order)'));
    table.header.forEach((name, i) =>
      sel.append(h('option', { value: i }, name || `column ${i + 1}`)),
    );
    sel.value = value === null ? '' : String(value);
    sel.addEventListener('change', () => apply(sel.value === '' ? null : Number(sel.value)));
    return h('label', { class: 'mini' }, h('span', { class: 'small muted' }, label), sel);
  };
  const interval = h(
    'select',
    { id: 'map-interval', 'aria-label': 'Daily or weekly' },
    h('option', { value: 'auto' }, 'detect automatically'),
    h('option', { value: '1' }, 'daily'),
    h('option', { value: '7' }, 'weekly'),
  );
  interval.value = String(mapping.interval);
  interval.addEventListener('change', () =>
    opts.onMappingChange({
      ...mapping,
      interval: interval.value === 'auto' ? 'auto' : interval.value === '7' ? 7 : 1,
    }),
  );
  root.append(
    h(
      'div',
      { class: 'row-gap' },
      colSelect(
        'Date / day column',
        mapping.dateColumn,
        true,
        (v) => opts.onMappingChange({ ...mapping, dateColumn: v }),
        'map-date',
      ),
      colSelect(
        'Case-count column',
        mapping.countColumn,
        false,
        (v) => opts.onMappingChange({ ...mapping, countColumn: v ?? 0 }),
        'map-count',
      ),
      h('label', { class: 'mini' }, h('span', { class: 'small muted' }, 'Time step'), interval),
    ),
  );
  const rows = table.rows.slice(0, 6);
  root.append(
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'line'),
            ...table.header.map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        h(
          'tbody',
          {},
          ...rows.map((r) =>
            h('tr', {}, h('td', {}, String(r.line)), ...r.cells.map((c) => h('td', {}, c))),
          ),
        ),
      ),
    ),
    h('p', { class: 'small muted' }, `Showing ${rows.length} of ${table.rows.length} rows.`),
  );
}

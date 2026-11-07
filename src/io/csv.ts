// Defensive CSV reading for case-count files. Nothing is dropped silently: every skipped, fixed or suspicious row is
// reported as an ImportProblem, and problems that make the data unusable block the import.
import type { ImportProblem, ObservedSeries } from '../shared/types';

export interface ParsedCsv {
  delimiter: string;
  header: string[];
  /** Data rows (cells as text) together with their 1-based file line numbers. */
  rows: { line: number; cells: string[] }[];
  problems: ImportProblem[];
}

/** Picks the most likely delimiter by counting candidates in the first lines (outside quotes). */
function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => {
      let n = 0;
      let inQuotes = false;
      for (const ch of l) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) n++;
      }
      return n;
    });
    const first = counts[0] ?? 0;
    const consistent = first > 0 && counts.every((c) => c === first);
    const score = consistent ? first + 1000 : first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Splits text into records, honouring quoted fields (with "" escapes and embedded delimiters/newlines). Returns cells plus start line. */
function splitRecords(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quotedField = false;
  const endField = (): void => {
    cells.push(quotedField ? field : field.trim());
    field = '';
    quotedField = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string; // i < length
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      quotedField = true;
      field = '';
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endField();
      records.push({ line: recordLine, cells });
      cells = [];
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (field !== '' || cells.length > 0) {
    endField();
    records.push({ line: recordLine, cells });
  }
  return records;
}

/** Reads CSV text into a header and rows; reports (never hides) structural problems. */
export function parseCsvText(rawText: string): ParsedCsv {
  const problems: ImportProblem[] = [];
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    problems.push({
      severity: 'info',
      line: null,
      message: 'Removed a byte-order mark (BOM) at the start of the file.',
    });
  }
  if (text.trim() === '') {
    problems.push({ severity: 'error', line: null, message: 'The file is empty.' });
    return { delimiter: ',', header: [], rows: [], problems };
  }
  const delimiter = detectDelimiter(text);
  if (delimiter !== ',')
    problems.push({
      severity: 'info',
      line: null,
      message: `Detected the delimiter ${delimiter === '\t' ? 'TAB' : `"${delimiter}"`}.`,
    });
  const records = splitRecords(text, delimiter);
  const nonEmpty = records.filter((r) => !(r.cells.length === 1 && r.cells[0] === ''));
  for (const r of records) {
    if (r.cells.length === 1 && r.cells[0] === '')
      problems.push({ severity: 'info', line: r.line, message: 'Blank line ignored.' });
  }
  const head = nonEmpty[0];
  if (head === undefined) {
    problems.push({ severity: 'error', line: null, message: 'The file has no header row.' });
    return { delimiter, header: [], rows: [], problems };
  }
  const header = head.cells;
  const rows: ParsedCsv['rows'] = [];
  for (const r of nonEmpty.slice(1)) {
    if (r.cells.length !== header.length) {
      problems.push({
        severity: 'warning',
        line: r.line,
        message: `Row has ${r.cells.length} cells but the header has ${header.length}; the row is skipped.`,
      });
      continue;
    }
    rows.push(r);
  }
  return { delimiter, header, rows, problems };
}

export interface ColumnMapping {
  /** Index of the date (or day-number) column; null = use row order. */
  dateColumn: number | null;
  countColumn: number;
  /** 'auto' detects daily vs weekly from the dates; 1 or 7 forces it. */
  interval: 'auto' | 1 | 7;
}

/** Guesses sensible columns from header names and cell contents. */
export function suggestMapping(table: ParsedCsv): ColumnMapping {
  const names = table.header.map((h) => h.toLowerCase());
  const dateIdx = names.findIndex((n) => /date|week|day|time|period/.test(n));
  const isNumeric = (col: number): boolean =>
    table.rows.length > 0 &&
    table.rows.every((r) => parseCount(r.cells[col] ?? '') !== null || (r.cells[col] ?? '') === '');
  let countIdx = names.findIndex(
    (n, i) =>
      i !== dateIdx && /case|count|admission|new|inci|n$|value|number/.test(n) && isNumeric(i),
  );
  if (countIdx < 0) countIdx = table.header.findIndex((_, i) => i !== dateIdx && isNumeric(i));
  return {
    dateColumn: dateIdx >= 0 ? dateIdx : null,
    countColumn: countIdx >= 0 ? countIdx : Math.max(0, table.header.length - 1),
    interval: 'auto',
  };
}

/** Parses a count cell: plain numbers, with thousands separators allowed; null if not numeric. */
function parseCount(cell: string): number | null {
  const t = cell.trim();
  if (t === '') return null;
  const cleaned = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

const MS_PER_DAY = 86_400_000;

/** Parses YYYY-MM-DD (optionally followed by a time), YYYY/MM/DD or M/D/YYYY into days since 1970-01-01 (UTC); null if invalid. */
export function parseDateToDay(cell: string): number | null {
  const t = cell.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(t);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (!match) return null;
    m = Number(match[1]); // US order month/day/year
    d = Number(match[2]);
    y = Number(match[3]);
  }
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
    return null;
  return Math.round(ms / MS_PER_DAY);
}

/** Formats days since 1970-01-01 as YYYY-MM-DD. */
export function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export type BuildResult =
  | { ok: true; series: ObservedSeries; problems: ImportProblem[] }
  | { ok: false; problems: ImportProblem[] };

/** Turns the chosen columns into a validated series; blocking problems return ok: false. */
export function buildSeries(table: ParsedCsv, mapping: ColumnMapping, label: string): BuildResult {
  const problems: ImportProblem[] = [...table.problems];
  const err = (line: number | null, message: string): void =>
    void problems.push({ severity: 'error', line, message });
  const warn = (line: number | null, message: string): void =>
    void problems.push({ severity: 'warning', line, message });
  const info = (line: number | null, message: string): void =>
    void problems.push({ severity: 'info', line, message });
  if (table.problems.some((p) => p.severity === 'error')) return { ok: false, problems };
  if (mapping.countColumn < 0 || mapping.countColumn >= table.header.length) {
    err(null, 'Choose which column holds the case counts.');
    return { ok: false, problems };
  }
  type Obs = { line: number; day: number; count: number; date: string | null };
  const obs: Obs[] = [];
  let dateFailures = 0;
  table.rows.forEach((r, index) => {
    const countCell = r.cells[mapping.countColumn] ?? '';
    if (countCell.trim() === '') {
      warn(r.line, 'The count is missing; this row is skipped (it is NOT treated as zero).');
      return;
    }
    const raw = parseCount(countCell);
    if (raw === null) {
      err(r.line, `"${countCell}" is not a number.`);
      return;
    }
    if (raw < 0) {
      err(r.line, `The count is negative (${raw}); counts cannot be below zero.`);
      return;
    }
    let count = raw;
    if (!Number.isInteger(raw)) {
      count = Math.round(raw);
      warn(
        r.line,
        `The count ${raw} is not a whole number; rounded to ${count} for the count-based likelihood.`,
      );
    }
    if (mapping.dateColumn === null) {
      // Row order stands in for time: consecutive rows are one interval apart (daily unless the user chose weekly).
      obs.push({ line: r.line, day: index * (mapping.interval === 7 ? 7 : 1), count, date: null });
      return;
    }
    const dateCell = r.cells[mapping.dateColumn] ?? '';
    const asNumber = /^\d+$/.test(dateCell.trim()) ? Number(dateCell.trim()) : null;
    const day =
      asNumber !== null && !/^\d{4}$/.test(dateCell.trim()) ? asNumber : parseDateToDay(dateCell);
    if (day === null) {
      dateFailures++;
      if (dateFailures <= 5)
        err(
          r.line,
          `"${dateCell}" is not a recognised date (use YYYY-MM-DD, YYYY/MM/DD or M/D/YYYY) or day number.`,
        );
      return;
    }
    obs.push({ line: r.line, day, count, date: asNumber !== null ? null : dayToIso(day) });
  });
  if (dateFailures > 5) err(null, `${dateFailures - 5} more rows have unrecognised dates.`);
  if (problems.some((p) => p.severity === 'error')) return { ok: false, problems };
  if (obs.length === 0) {
    err(null, 'No usable rows were found.');
    return { ok: false, problems };
  }
  // Order and duplicates.
  const sorted = obs.every((o, i) => i === 0 || o.day >= (obs[i - 1] as Obs).day);
  if (!sorted) {
    obs.sort((a, b) => a.day - b.day);
    warn(null, 'Rows were not in date order; they were sorted by date.');
  }
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1] as Obs;
    const b = obs[i] as Obs;
    if (a.day === b.day)
      err(
        b.line,
        `Duplicate date: lines ${a.line} and ${b.line} have the same date. Remove or merge one.`,
      );
  }
  if (problems.some((p) => p.severity === 'error')) return { ok: false, problems };
  if (obs.length < 5) {
    err(null, `Only ${obs.length} usable observations; at least 5 are needed to fit anything.`);
    return { ok: false, problems };
  }
  if (obs.length < 8)
    warn(null, `Only ${obs.length} observations: the fit will be very uncertain.`);
  if (obs.every((o) => o.count === 0)) {
    err(null, 'Every count is zero; there is nothing to fit.');
    return { ok: false, problems };
  }
  // Daily or weekly?
  const gaps = obs.slice(1).map((o, i) => o.day - (obs[i] as Obs).day);
  let interval: 1 | 7;
  if (mapping.interval !== 'auto') interval = mapping.interval;
  else {
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 1;
    if (median === 1) interval = 1;
    else if (median === 7) interval = 7;
    else {
      err(
        null,
        `The typical gap between rows is ${median} days, so I cannot tell if the data is daily or weekly. Choose "daily" or "weekly" manually.`,
      );
      return { ok: false, problems };
    }
    info(
      null,
      `Detected ${interval === 1 ? 'daily' : 'weekly'} data (typical gap ${median} day${median === 1 ? '' : 's'}).`,
    );
  }
  const irregular = gaps.filter((g) => g !== interval);
  if (irregular.length > 0) {
    const small = gaps.filter((g) => g < interval);
    if (small.length > 0)
      err(
        null,
        `Some rows are closer together (${Math.min(...small)} day) than the ${interval}-day interval; the intervals would overlap. Check the dates or the interval setting.`,
      );
    else
      warn(
        null,
        `${irregular.length} gap${irregular.length === 1 ? '' : 's'} between rows are longer than ${interval} day${interval === 1 ? '' : 's'} (missing observations); they are left out, not filled in.`,
      );
  }
  if (problems.some((p) => p.severity === 'error')) return { ok: false, problems };
  const first = (obs[0] as Obs).day;
  return {
    ok: true,
    problems,
    series: {
      label,
      counts: obs.map((o) => o.count),
      endDays: obs.map((o) => o.day - first + interval), // model day 0 = start of the first interval
      intervalDays: interval,
      dates: mapping.dateColumn === null ? null : obs.map((o) => o.date ?? String(o.day)),
    },
  };
}

/** Keeps observations from index `from` to `to` (inclusive); model day 0 moves to the start of the first kept interval. */
export function trimSeries(series: ObservedSeries, from: number, to: number): ObservedSeries {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(series.counts.length - 1, Math.max(from, to));
  const offset = (series.endDays[lo] as number) - series.intervalDays;
  return {
    ...series,
    counts: series.counts.slice(lo, hi + 1),
    endDays: series.endDays.slice(lo, hi + 1).map((d) => d - offset),
    dates: series.dates ? series.dates.slice(lo, hi + 1) : null,
  };
}

/** Convenience: parse text, suggest columns, and build the series in one step. */
export function importCsvText(
  text: string,
  label: string,
): BuildResult & { table: ParsedCsv; mapping: ColumnMapping } {
  const table = parseCsvText(text);
  const mapping = suggestMapping(table);
  return { ...buildSeries(table, mapping, label), table, mapping };
}

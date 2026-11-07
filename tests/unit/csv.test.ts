import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  dayToIso,
  importCsvText,
  parseCsvText,
  parseDateToDay,
  suggestMapping,
  trimSeries,
} from '../../src/io/csv';

const fx = (name: string): string =>
  readFileSync(path.resolve(import.meta.dirname, '../fixtures/csv', name), 'utf8');
const messages = (r: { problems: { message: string }[] }): string =>
  r.problems.map((p) => p.message).join(' | ');

describe('good files', () => {
  it('weekly file: detects weekly, builds model-day end times, keeps every row', () => {
    const r = importCsvText(fx('good-weekly.csv'), 'w');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.series.intervalDays).toBe(7);
    expect(r.series.counts).toEqual([3, 5, 9, 16, 30, 41, 38, 25, 15, 8]);
    expect(r.series.endDays).toEqual([7, 14, 21, 28, 35, 42, 49, 56, 63, 70]); // day 0 = start of the first week
    expect(r.series.dates?.[0]).toBe('2024-01-07');
    expect(messages(r)).toMatch(/weekly/);
  });
  it('daily file: detects daily', () => {
    const r = importCsvText(fx('good-daily.csv'), 'd');
    expect(r.ok && r.series.intervalDays).toBe(1);
    expect(r.ok && r.series.counts.length).toBe(20);
  });
  it('BOM + semicolon delimiter + CRLF line endings', () => {
    const r = importCsvText(fx('bom-semicolon.csv'), 'b');
    expect(r.ok).toBe(true);
    expect(messages(r)).toMatch(/byte-order mark/);
    expect(messages(r)).toMatch(/delimiter ";"/);
    expect(r.ok && r.series.counts).toEqual([3, 5, 9, 16, 30, 41]);
  });
  it('quoted headers, embedded commas and thousands separators', () => {
    const r = importCsvText(fx('quoted.csv'), 'q');
    expect(r.table.header).toEqual(['Week ending', 'Cases, confirmed']);
    expect(r.ok && r.series.counts).toEqual([1234, 2000, 3100, 2500, 1900]);
  });
  it('column suggestion finds the date and count columns', () => {
    const t = parseCsvText(fx('good-daily.csv'));
    expect(suggestMapping(t)).toEqual({ dateColumn: 0, countColumn: 1, interval: 'auto' });
  });
  it('a day-index file works without calendar dates', () => {
    const r = importCsvText(fx('day-index.csv'), 'i');
    expect(r.ok && r.series.intervalDays).toBe(1);
    expect(r.ok && r.series.endDays).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('row order can be used when there is no date column', () => {
    const t = parseCsvText('cases\n1\n2\n4\n8\n16\n');
    const r = buildSeries(t, { dateColumn: null, countColumn: 0, interval: 7 }, 'x');
    expect(r.ok && r.series.endDays).toEqual([7, 14, 21, 28, 35]);
  });
});

describe('problems are reported, never silent', () => {
  it('negative count blocks the import and names the line', () => {
    const r = importCsvText(fx('bad-negative.csv'), 'x');
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.severity === 'error')).toMatchObject({ line: 3 });
    expect(messages(r)).toMatch(/negative/);
  });
  it('non-numeric text blocks the import', () => {
    const r = importCsvText(fx('bad-nonnumeric.csv'), 'x');
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/"many" is not a number/);
  });
  it('duplicate dates block the import and name both lines', () => {
    const r = importCsvText(fx('bad-duplicate-dates.csv'), 'x');
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/Duplicate date: lines 3 and 4/);
  });
  it('unparseable and impossible dates (Feb 30) are listed', () => {
    const r = importCsvText(fx('bad-dates.csv'), 'x');
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/last tuesday/);
    expect(messages(r)).toMatch(/2024-02-30/);
  });
  it('missing counts are skipped with a warning (not treated as zero)', () => {
    const r = importCsvText(fx('missing-values.csv'), 'x');
    expect(r.ok).toBe(true);
    expect(messages(r)).toMatch(/missing; this row is skipped \(it is NOT treated as zero\)/);
    expect(r.ok && r.series.counts).toEqual([3, 9, 16, 30, 41, 38]);
    expect(r.ok && r.series.endDays).toEqual([7, 21, 28, 35, 42, 49]); // the gap is kept as a gap
  });
  it('unsorted rows are sorted, and the user is told', () => {
    const r = importCsvText(fx('unsorted.csv'), 'x');
    expect(r.ok).toBe(true);
    expect(messages(r)).toMatch(/sorted by date/);
    expect(r.ok && r.series.counts).toEqual([3, 5, 9, 16, 30, 41, 38, 25]);
  });
  it('ragged rows are skipped with a line number', () => {
    const r = importCsvText(fx('ragged.csv'), 'x');
    expect(messages(r)).toMatch(/Row has 3 cells but the header has 2/);
    expect(r.problems.some((p) => p.line === 3)).toBe(true);
  });
  it('missing weeks produce a gap warning, not invented rows', () => {
    const r = importCsvText(fx('gaps-weekly.csv'), 'x');
    expect(r.ok).toBe(true);
    expect(messages(r)).toMatch(/missing observations/);
    expect(r.ok && r.series.counts.length).toBe(6);
  });
  it('empty file, too few rows, all-zero counts and ambiguous spacing are rejected with clear messages', () => {
    expect(messages(importCsvText(fx('empty.csv'), 'x'))).toMatch(/empty/);
    expect(importCsvText(fx('too-short.csv'), 'x').ok).toBe(false);
    expect(messages(importCsvText(fx('too-short.csv'), 'x'))).toMatch(/at least 5/);
    expect(messages(importCsvText(fx('decimals-allzero.csv'), 'x'))).toMatch(/Every count is zero/);
    expect(messages(importCsvText(fx('ambiguous-gap.csv'), 'x'))).toMatch(
      /cannot tell if the data is daily or weekly/,
    );
  });
  it('forcing the interval overrides detection; rounding of non-integer counts is reported', () => {
    const t = parseCsvText(
      'date,cases\n2024-01-07,1.4\n2024-01-14,2.6\n2024-01-21,5\n2024-01-28,9\n2024-02-04,12\n',
    );
    const r = buildSeries(t, { dateColumn: 0, countColumn: 1, interval: 7 }, 'x');
    expect(r.ok && r.series.counts).toEqual([1, 3, 5, 9, 12]);
    expect(messages(r)).toMatch(/rounded to 1/);
  });
  it('overlapping intervals (daily dates forced to weekly) are rejected', () => {
    const t = parseCsvText(fx('good-daily.csv'));
    const r = buildSeries(t, { dateColumn: 0, countColumn: 1, interval: 7 }, 'x');
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/overlap/);
  });
});

describe('dates and trimming', () => {
  it('parses ISO, slashed and US dates; rejects impossible ones', () => {
    expect(dayToIso(parseDateToDay('2024-03-01') as number)).toBe('2024-03-01');
    expect(parseDateToDay('2024/03/01')).toBe(parseDateToDay('2024-03-01'));
    expect(parseDateToDay('3/1/2024')).toBe(parseDateToDay('2024-03-01'));
    expect(parseDateToDay('2024-03-01T00:00:00.000')).toBe(parseDateToDay('2024-03-01'));
    expect(parseDateToDay('2023-02-29')).toBeNull();
    expect(parseDateToDay('banana')).toBeNull();
  });
  it('trimSeries re-bases model day 0 to the first kept interval', () => {
    const r = importCsvText(fx('good-weekly.csv'), 'w');
    if (!r.ok) throw new Error('good file');
    const t = trimSeries(r.series, 2, 5);
    expect(t.counts).toEqual([9, 16, 30, 41]);
    expect(t.endDays).toEqual([7, 14, 21, 28]);
    expect(t.dates?.[0]).toBe('2024-01-21');
  });
});

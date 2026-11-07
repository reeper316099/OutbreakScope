// Bundled sample datasets: manifest parsing (zod) and conversion of an entry plus its CSV text into a fit-ready series.
import { datasetManifestSchema } from '../shared/schemas';
import type { DatasetEntry } from '../shared/schemas';
import type { ImportProblem, ObservedSeries } from '../shared/types';
import { buildSeries, parseCsvText } from './csv';

export type ManifestResult =
  { ok: true; datasets: DatasetEntry[] } | { ok: false; message: string };

/** Parses and validates datasets/manifest.json text. */
export function parseManifest(text: string): ManifestResult {
  try {
    const parsed = datasetManifestSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return {
        ok: false,
        message: `The dataset manifest is invalid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`,
      };
    return { ok: true, datasets: parsed.data.datasets };
  } catch {
    return { ok: false, message: 'The dataset manifest is not valid JSON.' };
  }
}

export type LoadedDataset =
  | { ok: true; series: ObservedSeries; problems: ImportProblem[] }
  | { ok: false; problems: ImportProblem[] };

/** Reads a bundled dataset's CSV using the columns named in its manifest entry. */
export function loadDataset(entry: DatasetEntry, csvText: string): LoadedDataset {
  const table = parseCsvText(csvText);
  const dateColumn = table.header.indexOf(entry.dateColumn);
  const countColumn = table.header.indexOf(entry.countColumn);
  if (dateColumn < 0 || countColumn < 0)
    return {
      ok: false,
      problems: [
        {
          severity: 'error',
          line: null,
          message: `The bundled file ${entry.file} does not have the columns named in the manifest.`,
        },
      ],
    };
  return buildSeries(
    table,
    { dateColumn, countColumn, interval: entry.resolution === 'daily' ? 1 : 7 },
    entry.title,
  );
}

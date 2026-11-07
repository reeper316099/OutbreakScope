// Bundled datasets are compiled into the app by Vite (no file reads or network at runtime).
import { parseManifest } from '../io/datasets';
import type { ManifestResult } from '../io/datasets';

// With query '?raw' and import 'default', Vite replaces each entry with the file's text.
const csvFiles = import.meta.glob<string>('../../datasets/*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const manifestFiles = import.meta.glob<string>('../../datasets/manifest.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const manifest: ManifestResult = parseManifest(Object.values(manifestFiles)[0] ?? '');

/** Raw CSV text of a bundled file by file name, or undefined. */
export function bundledCsv(file: string): string | undefined {
  return Object.entries(csvFiles).find(([p]) => p.endsWith(`/${file}`))?.[1];
}

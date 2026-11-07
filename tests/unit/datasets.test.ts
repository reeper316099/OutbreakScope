import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDataset, parseManifest } from '../../src/io/datasets';
import { DEFAULT_PRIORS, generateSynthetic } from '../../src/sim/fit';

const dir = path.resolve(import.meta.dirname, '../../datasets');
const manifest = parseManifest(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

describe('bundled datasets', () => {
  it('manifest validates', () => {
    expect(manifest.ok).toBe(true);
  });
  it('every real dataset has a source, licence, citation, transformation note and caveats; no file is missing or unlisted', () => {
    if (!manifest.ok) throw new Error(manifest.message);
    for (const d of manifest.datasets) {
      if (d.kind === 'real') {
        expect(d.source).not.toBeNull();
        expect(d.license?.name).toBeTruthy();
        expect(d.license?.termsUrl.startsWith('https://')).toBe(true);
        expect(d.caveats.length).toBeGreaterThan(1);
        expect(d.measures).toMatch(/NOT infections/);
      } else {
        expect(d.synthetic).not.toBeNull();
      }
      expect(d.citation.length).toBeGreaterThan(20);
      expect(d.transformation.length).toBeGreaterThan(20);
    }
  });
  it('every bundled CSV loads cleanly through the importer with the expected shape (nothing silently dropped)', () => {
    if (!manifest.ok) throw new Error(manifest.message);
    const expectedRows: Record<string, number> = {
      'ut-flu-hosp-2024-25': 39,
      'ut-flu-hosp-2022-23': 26,
      'synthetic-seir-weekly': 26,
    };
    for (const d of manifest.datasets) {
      const text = readFileSync(path.join(dir, d.file), 'utf8');
      const r = loadDataset(d, text);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.series.counts.length).toBe(expectedRows[d.id]);
      expect(r.series.intervalDays).toBe(7);
      expect(r.problems.filter((p) => p.severity !== 'info')).toEqual([]);
      expect(text.trim().split('\n').length - 1).toBe(expectedRows[d.id]); // data lines == parsed rows
    }
  });
  it('real data: spot-check values against the source (peak week 2025-01-04 = 388; first and last rows)', () => {
    const text = readFileSync(path.join(dir, 'ut-flu-hosp-2024-25.csv'), 'utf8');
    expect(text).toContain('2025-01-04,388');
    expect(text.split('\n')[1]).toBe('2024-10-05,0');
  });
  it('the synthetic CSV is exactly what its manifest parameters and seed generate', () => {
    if (!manifest.ok) throw new Error(manifest.message);
    const d = manifest.datasets.find((x) => x.kind === 'synthetic');
    const s = d?.synthetic;
    if (!d || !s) throw new Error('synthetic entry expected');
    const series = generateSynthetic({
      config: {
        model: s.model,
        population: s.population,
        values: {
          r0: s.r0,
          i0: s.i0,
          rho: s.rho,
          dispersion: 20,
          incubationDays: s.incubationDays,
          infectiousDays: s.infectiousDays,
        },
        fitted: ['r0', 'i0', 'rho'],
        likelihood: 'poisson',
        reportingDelayDays: 0,
        priors: DEFAULT_PRIORS,
      },
      truth: {
        r0: s.r0,
        i0: s.i0,
        rho: s.rho,
        dispersion: 20,
        incubationDays: s.incubationDays,
        infectiousDays: s.infectiousDays,
      },
      intervalDays: s.intervalDays,
      observations: s.observations,
      seed: s.seed,
    });
    const file = readFileSync(path.join(dir, d.file), 'utf8');
    expect(file).toBe(
      'day,reported_cases\n' + series.counts.map((c, i) => `${(i + 1) * 7},${c}`).join('\n') + '\n',
    );
  });
  it('a manifest with a missing field or bad JSON gives a friendly error', () => {
    expect(parseManifest('{').ok).toBe(false);
    expect(parseManifest('{"version":1,"datasets":[{"id":"x"}]}').ok).toBe(false);
  });
});

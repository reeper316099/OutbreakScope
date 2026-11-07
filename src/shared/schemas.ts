// Runtime (zod) schemas. Types vanish at runtime, so everything crossing a trust boundary is parsed here.
import { z } from 'zod';
import type { OpenFileRequest, SaveFileRequest } from './types';
import { MAX_SAVE_BYTES } from './types';

export const openFileRequestSchema = z.strictObject({
  kind: z.enum(['csv', 'scenario']),
}) satisfies z.ZodType<OpenFileRequest>;

export const saveFileRequestSchema = z.strictObject({
  kind: z.enum(['scenario', 'csv', 'png']),
  defaultName: z.string().min(1).max(200),
  data: z.string().max(MAX_SAVE_BYTES),
  encoding: z.enum(['utf8', 'base64']),
}) satisfies z.ZodType<SaveFileRequest>;

export const openExternalRequestSchema = z.string().min(1).max(2048);

/** Saved window geometry (userData/window-state.json). */
export const windowStateSchema = z.object({
  width: z.number().int().min(1100).max(10000),
  height: z.number().int().min(720).max(10000),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

// ---- Scenario files and stored preferences.

export const SCENARIO_FORMAT_VERSION = 1;

const userParamsSchema = z.object({
  model: z.enum(['SIR', 'SEIR', 'SEIRV']),
  r0: z.number(),
  incubationDays: z.number(),
  infectiousDays: z.number(),
  population: z.number(),
  initialInfected: z.number(),
  vaccineEfficacy: z.number(),
  horizonDays: z.number(),
});

const interventionSchema = z.object({
  type: z.enum(['contact_reduction', 'vaccination']),
  startDay: z.number(),
  endDay: z.number(),
  strength: z.number(),
});

/** Body of a saved scenario; numbers are range-checked later by validateScenario (so the UI can explain problems). */
export const scenarioSchema = z.object({
  params: userParamsSchema,
  interventions: z.array(interventionSchema).max(50),
  seed: z.number().int().min(0).max(4294967295),
  ensembleSize: z.number().int().min(1).max(1000),
});

/** A scenario file on disk. formatVersion lets newer files be recognised and refused politely. */
export const scenarioFileSchema = z.object({
  app: z.literal('OutbreakScope'),
  formatVersion: z.number().int(),
  appVersion: z.string(),
  savedAt: z.string(),
  scenario: scenarioSchema,
});
export type ScenarioFile = z.infer<typeof scenarioFileSchema>;

/** Preferences kept in localStorage (typed storage layer). */
export const preferencesSchema = z.object({ theme: z.enum(['light', 'dark']).optional() });
export type Preferences = z.infer<typeof preferencesSchema>;

// ---- Bundled dataset manifest (datasets/manifest.json).

export const datasetEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  file: z.string().regex(/^[A-Za-z0-9._-]+\.csv$/),
  kind: z.enum(['real', 'synthetic']),
  resolution: z.enum(['daily', 'weekly']),
  dateColumn: z.string(),
  countColumn: z.string(),
  /** What the counts measure (never "infections"). */
  measures: z.string(),
  /** Population of the area, if a sourced figure exists; null = not available in the dataset. */
  populationHint: z
    .object({ value: z.number().positive(), description: z.string(), url: z.url() })
    .nullable(),
  source: z
    .object({ name: z.string(), url: z.url(), retrieved: z.string(), query: z.string() })
    .nullable(),
  license: z.object({ name: z.string(), termsUrl: z.url(), note: z.string() }).nullable(),
  citation: z.string(),
  transformation: z.string(),
  caveats: z.array(z.string()),
  /** For synthetic data: exactly how it was generated. */
  synthetic: z
    .object({
      seed: z.number().int(),
      model: z.enum(['SIR', 'SEIR']),
      population: z.number(),
      r0: z.number(),
      i0: z.number(),
      rho: z.number(),
      incubationDays: z.number(),
      infectiousDays: z.number(),
      observations: z.number().int(),
      intervalDays: z.union([z.literal(1), z.literal(7)]),
    })
    .nullable(),
});

export const datasetManifestSchema = z.object({
  version: z.literal(1),
  datasets: z.array(datasetEntrySchema),
});
export type DatasetEntry = z.infer<typeof datasetEntrySchema>;

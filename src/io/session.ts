// Save/load scenarios as JSON. Everything read from disk goes through zod, then the usual scenario validation.
import { SCENARIO_FORMAT_VERSION, scenarioFileSchema } from '../shared/schemas';
import type { Scenario } from '../shared/types';
import { validateScenario } from '../sim/scenario';

export type LoadScenarioResult =
  { ok: true; scenario: Scenario; appVersion: string } | { ok: false; message: string };

/** Serialises a scenario (with app version and format version) to pretty JSON text. */
export function serializeScenario(
  scenario: Scenario,
  appVersion: string,
  now: Date = new Date(),
): string {
  return JSON.stringify(
    {
      app: 'OutbreakScope',
      formatVersion: SCENARIO_FORMAT_VERSION,
      appVersion,
      savedAt: now.toISOString(),
      scenario,
    },
    null,
    2,
  );
}

/** Parses scenario-file text; returns a friendly message for corrupted, wrong-type, newer-version or invalid files. */
export function parseScenarioFile(text: string): LoadScenarioResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message:
        'This file is not valid JSON, so it cannot be an OutbreakScope scenario (it may be corrupted).',
    };
  }
  const versionProbe =
    typeof raw === 'object' && raw !== null
      ? (raw as { formatVersion?: unknown }).formatVersion
      : undefined; // only read to give a better message
  if (typeof versionProbe === 'number' && versionProbe > SCENARIO_FORMAT_VERSION) {
    return {
      ok: false,
      message: `This scenario was saved by a newer version of OutbreakScope (file format ${versionProbe}; this app reads format ${SCENARIO_FORMAT_VERSION}). Please update the app.`,
    };
  }
  const parsed = scenarioFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      message: `This does not look like an OutbreakScope scenario file (${first ? `${first.path.join('.') || 'file'}: ${first.message}` : 'unrecognised structure'}).`,
    };
  }
  if (parsed.data.formatVersion !== SCENARIO_FORMAT_VERSION) {
    return { ok: false, message: `Unsupported scenario file format ${parsed.data.formatVersion}.` };
  }
  const scenario: Scenario = parsed.data.scenario;
  const issues = validateScenario(scenario);
  if (issues.length > 0) {
    return {
      ok: false,
      message: `The scenario file has invalid values: ${issues.map((i) => i.message).join(' ')}`,
    };
  }
  return { ok: true, scenario, appVersion: parsed.data.appVersion };
}

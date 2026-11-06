// Shared types used by main, preload, renderer and workers so every message boundary is type-checked on both sides.

/** Largest file the main process will read for the renderer (bytes). */
export const MAX_OPEN_BYTES = 5 * 1024 * 1024;
/** Largest payload the main process will write for the renderer (bytes). */
export const MAX_SAVE_BYTES = 50 * 1024 * 1024;

/** What the user is opening: a CSV of case counts or a saved scenario JSON. */
export type OpenKind = 'csv' | 'scenario';
/** What the user is saving: a scenario JSON, a CSV time series, or a PNG chart. */
export type SaveKind = 'scenario' | 'csv' | 'png';

export interface OpenFileRequest {
  kind: OpenKind;
}

export type OpenFileFailure = 'cancelled' | 'too_large' | 'wrong_type' | 'read_error';

/** Result of the native open dialog; text is returned unparsed (the renderer validates it with zod). */
export type OpenFileResult =
  | { ok: true; name: string; text: string }
  | { ok: false; reason: OpenFileFailure; message: string };

export interface SaveFileRequest {
  kind: SaveKind;
  /** Suggested file name (the main process sanitises it). */
  defaultName: string;
  /** Text for csv/scenario; base64 (no data: prefix) for png. */
  data: string;
  encoding: 'utf8' | 'base64';
}

export type SaveFileFailure = 'cancelled' | 'too_large' | 'invalid' | 'write_error';

export type SaveFileResult =
  { ok: true; name: string } | { ok: false; reason: SaveFileFailure; message: string };

export type OpenExternalResult = { ok: true } | { ok: false; message: string };

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  isPackaged: boolean;
}

/** The ONLY API the preload script exposes to the renderer (as window.outbreakscope). */
export interface OutbreakScopeApi {
  openFile(request: OpenFileRequest): Promise<OpenFileResult>;
  saveFile(request: SaveFileRequest): Promise<SaveFileResult>;
  openExternal(url: string): Promise<OpenExternalResult>;
  getAppInfo(): Promise<AppInfo>;
}

export const IPC_CHANNELS = {
  openFile: 'outbreakscope:open-file',
  saveFile: 'outbreakscope:save-file',
  openExternal: 'outbreakscope:open-external',
  getAppInfo: 'outbreakscope:get-app-info',
} as const;

/** Actions the native menu can ask the renderer to perform (fixed list; never user text). */
export const MENU_ACTIONS = [
  'file:open-csv',
  'file:open-scenario',
  'file:save-scenario',
  'file:export-csv',
  'file:export-png',
  'view:toggle-dark',
  'view:simulator',
  'view:explainer',
  'view:fit',
  'view:about',
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

export const MENU_EVENT_NAME = 'outbreakscope:menu';

// ---- Worker messages (discriminated unions). The shell only has a ping worker; real workers come later.
export type PingRequest = { type: 'ping'; id: number; value: number };
export type PingResponse =
  { type: 'pong'; id: number; value: number } | { type: 'error'; id: number; message: string };

/** UI state for any async panel. */
export type TaskState<T> =
  | { status: 'idle' }
  | { status: 'running'; progress: number }
  | { status: 'done'; result: T }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// ---- Epidemic domain types (see MODEL.md). User-facing quantities are R0 and days; internal rates are per day.

/** Which compartmental model is being run. */
export type ModelKind = 'SIR' | 'SEIR' | 'SEIRV';

/** Compartment names. E is unused (always 0) in SIR; V is unused (always 0) without vaccination. */
export type Compartment = 'S' | 'E' | 'I' | 'R' | 'V';

/** Everything the user can set about the disease and the population (user-facing units). */
export interface UserParams {
  model: ModelKind;
  /** Basic reproduction number R0 (dimensionless): infections caused by one case in a fully susceptible population. */
  r0: number;
  /** Mean incubation period in days (E -> I). Ignored for SIR. */
  incubationDays: number;
  /** Mean infectious period in days (I -> R). */
  infectiousDays: number;
  /** Total population N (people). */
  population: number;
  /** People infectious at day 0 (placed in I). */
  initialInfected: number;
  /** Vaccine efficacy against infection in [0, 1] (leaky vaccine). Only used by SEIRV. */
  vaccineEfficacy: number;
  /** Length of the simulation in days. */
  horizonDays: number;
}

/** Internal per-day rates derived from UserParams by src/sim/params.ts (the only place that converts). */
export interface InternalParams {
  /** Transmission rate beta = R0 * gamma (per day). */
  betaPerDay: number;
  /** Progression rate sigma = 1 / incubation days (per day); null for SIR. */
  sigmaPerDay: number | null;
  /** Recovery rate gamma = 1 / infectious days (per day). */
  gammaPerDay: number;
}

/** A timed change to the epidemic. Days are measured from day 0; the event is active on [startDay, endDay). */
export type Intervention =
  | {
      type: 'contact_reduction';
      startDay: number;
      endDay: number;
      /** Fraction of contacts removed, in [0, 1]; 0.4 means contacts drop by 40%. */
      strength: number;
    }
  | {
      type: 'vaccination';
      startDay: number;
      endDay: number;
      /** Fraction of the currently susceptible population vaccinated per day, in [0, 1]. */
      strength: number;
    };

/** A stretch of time over which all rates are constant. */
export interface ScheduleSegment {
  startDay: number;
  endDay: number;
  /** Product of (1 - strength) over active contact reductions; 1 means no reduction. */
  contactMultiplier: number;
  /** Sum of active vaccination rates (per day). */
  vaccinationRatePerDay: number;
}

/** Deterministic solution sampled on an output grid. All arrays have the same length. */
export interface Trajectory {
  times: Float64Array;
  S: Float64Array;
  E: Float64Array;
  I: Float64Array;
  R: Float64Array;
  V: Float64Array;
  /** Cumulative infections since day 0 (including the initial infected). */
  cumInfections: Float64Array;
  /** Cumulative entries into I (symptom-onset-like flow, sigma*E for SEIR; equals infections for SIR). */
  cumOnsets: Float64Array;
  /** Cumulative vaccinations of susceptibles. */
  cumVaccinated: Float64Array;
}

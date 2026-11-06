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

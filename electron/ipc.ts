// IPC handlers. Every request is validated at runtime (zod) in addition to its static type.
import { app, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  openExternalRequestSchema,
  openFileRequestSchema,
  saveFileRequestSchema,
} from '../src/shared/schemas';
import { IPC_CHANNELS, MAX_OPEN_BYTES, MAX_SAVE_BYTES } from '../src/shared/types';
import type {
  AppInfo,
  OpenFileResult,
  OpenExternalResult,
  OpenKind,
  SaveFileResult,
  SaveKind,
} from '../src/shared/types';
import { isAllowedExternalUrl } from './allowlist';

const OPEN_FILTERS: Record<OpenKind, { name: string; extensions: string[] }> = {
  csv: { name: 'CSV / text', extensions: ['csv', 'tsv', 'txt'] },
  scenario: { name: 'OutbreakScope scenario', extensions: ['json'] },
};
const SAVE_FILTERS: Record<SaveKind, { name: string; extensions: string[] }> = {
  scenario: { name: 'OutbreakScope scenario', extensions: ['json'] },
  csv: { name: 'CSV', extensions: ['csv'] },
  png: { name: 'PNG image', extensions: ['png'] },
};

/** Makes a safe default file name: base name only, no control chars, forced extension. */
export function sanitizeFileName(name: string, extension: string): string {
  const cleaned = Array.from(path.basename(name), (ch) =>
    ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch,
  ).join('');
  const base = cleaned.slice(0, 120);
  const stem = base.replace(/\.[^.]*$/, '') || 'outbreakscope';
  return `${stem}.${extension}`;
}

/** Registers all IPC handlers; isTrusted decides whether a caller's page URL belongs to our app. */
export function registerIpc(isTrusted: (url: string) => boolean): void {
  const guard = (event: IpcMainInvokeEvent): boolean => isTrusted(event.senderFrame?.url ?? '');

  ipcMain.handle(IPC_CHANNELS.openFile, async (event, raw: unknown): Promise<OpenFileResult> => {
    const bad: OpenFileResult = {
      ok: false,
      reason: 'read_error',
      message: 'Request was not accepted.',
    };
    if (!guard(event)) return bad;
    const req = openFileRequestSchema.safeParse(raw);
    if (!req.success) return bad;
    const filter = OPEN_FILTERS[req.data.kind];
    const chosen = await dialog.showOpenDialog({ properties: ['openFile'], filters: [filter] });
    const file = chosen.filePaths[0];
    if (chosen.canceled || file === undefined)
      return { ok: false, reason: 'cancelled', message: 'No file chosen.' };
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!filter.extensions.includes(ext))
      return {
        ok: false,
        reason: 'wrong_type',
        message: `Expected a .${filter.extensions.join(' / .')} file.`,
      };
    try {
      const info = await stat(file);
      if (!info.isFile())
        return { ok: false, reason: 'wrong_type', message: 'That is not a regular file.' };
      if (info.size > MAX_OPEN_BYTES)
        return {
          ok: false,
          reason: 'too_large',
          message: `File is larger than ${MAX_OPEN_BYTES / 1024 / 1024} MB.`,
        };
      const buffer = await readFile(file);
      if (buffer.length > MAX_OPEN_BYTES)
        return {
          ok: false,
          reason: 'too_large',
          message: `File is larger than ${MAX_OPEN_BYTES / 1024 / 1024} MB.`,
        };
      if (buffer.includes(0))
        return { ok: false, reason: 'wrong_type', message: 'File looks binary, not text.' };
      return { ok: true, name: path.basename(file), text: buffer.toString('utf8') };
    } catch {
      return { ok: false, reason: 'read_error', message: 'Could not read that file.' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.saveFile, async (event, raw: unknown): Promise<SaveFileResult> => {
    if (!guard(event))
      return { ok: false, reason: 'invalid', message: 'Request was not accepted.' };
    const req = saveFileRequestSchema.safeParse(raw);
    if (!req.success) return { ok: false, reason: 'invalid', message: 'Invalid save request.' };
    const { kind, defaultName, data, encoding } = req.data;
    if ((kind === 'png') !== (encoding === 'base64'))
      return { ok: false, reason: 'invalid', message: 'PNG must be base64; text must be utf8.' };
    const bytes = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
    if (bytes.length > MAX_SAVE_BYTES)
      return { ok: false, reason: 'too_large', message: 'Data is too large to save.' };
    const filter = SAVE_FILTERS[kind];
    const ext = filter.extensions[0] ?? 'txt';
    const chosen = await dialog.showSaveDialog({
      defaultPath: sanitizeFileName(defaultName, ext),
      filters: [filter],
    });
    if (chosen.canceled || chosen.filePath === '')
      return { ok: false, reason: 'cancelled', message: 'Save cancelled.' };
    try {
      await writeFile(chosen.filePath, bytes);
      return { ok: true, name: path.basename(chosen.filePath) };
    } catch {
      return { ok: false, reason: 'write_error', message: 'Could not write the file.' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.openExternal,
    async (event, raw: unknown): Promise<OpenExternalResult> => {
      if (!guard(event)) return { ok: false, message: 'Request was not accepted.' };
      const url = openExternalRequestSchema.safeParse(raw);
      if (!url.success || !isAllowedExternalUrl(url.data))
        return { ok: false, message: 'Link is not on the allowlist (https only).' };
      await shell.openExternal(url.data);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event): AppInfo => {
    if (!guard(event)) throw new Error('Request was not accepted.');
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      isPackaged: app.isPackaged,
    };
  });
}

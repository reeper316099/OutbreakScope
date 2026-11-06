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

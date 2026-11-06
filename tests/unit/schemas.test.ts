import { describe, expect, it } from 'vitest';
import {
  openFileRequestSchema,
  saveFileRequestSchema,
  windowStateSchema,
} from '../../src/shared/schemas';

describe('IPC schemas', () => {
  it('accepts valid open requests and rejects unknown kinds or extra keys', () => {
    expect(openFileRequestSchema.safeParse({ kind: 'csv' }).success).toBe(true);
    expect(openFileRequestSchema.safeParse({ kind: 'exe' }).success).toBe(false);
    expect(openFileRequestSchema.safeParse({ kind: 'csv', path: '/etc/passwd' }).success).toBe(
      false,
    );
    expect(openFileRequestSchema.safeParse(null).success).toBe(false);
  });
  it('validates save requests', () => {
    const ok = { kind: 'csv', defaultName: 'a.csv', data: 'x', encoding: 'utf8' };
    expect(saveFileRequestSchema.safeParse(ok).success).toBe(true);
    expect(saveFileRequestSchema.safeParse({ ...ok, defaultName: '' }).success).toBe(false);
    expect(saveFileRequestSchema.safeParse({ ...ok, encoding: 'latin1' }).success).toBe(false);
  });
  it('validates saved window state', () => {
    expect(
      windowStateSchema.safeParse({ width: 1200, height: 800, maximized: false }).success,
    ).toBe(true);
    expect(windowStateSchema.safeParse({ width: 10, height: 800, maximized: false }).success).toBe(
      false,
    );
  });
});

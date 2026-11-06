// Remembers window size/position between runs (validated with zod on read).
import { app, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { windowStateSchema } from '../src/shared/schemas';
import type { WindowState } from '../src/shared/schemas';

const DEFAULT_STATE: WindowState = { width: 1280, height: 800, maximized: false };

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/** Loads saved geometry; falls back to defaults on any problem, and drops x/y if the window would be off-screen. */
export function loadWindowState(): WindowState {
  try {
    const parsed = windowStateSchema.safeParse(JSON.parse(readFileSync(stateFile(), 'utf8')));
    if (!parsed.success) return DEFAULT_STATE;
    const s = parsed.data;
    if (s.x === undefined || s.y === undefined) return s;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        s.x !== undefined &&
        s.y !== undefined &&
        s.x < a.x + a.width - 100 &&
        s.x + s.width > a.x + 100 &&
        s.y >= a.y - 10 &&
        s.y < a.y + a.height - 100
      );
    });
    return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Starts saving geometry (debounced) as the window moves/resizes and on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    const state: WindowState = {
      width: b.width,
      height: b.height,
      x: b.x,
      y: b.y,
      maximized: win.isMaximized(),
    };
    try {
      writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      /* losing window geometry is harmless */
    }
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', save);
}

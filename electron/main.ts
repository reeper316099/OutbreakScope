// Electron main process: window, custom app:// protocol, security settings, menu, IPC.
import { BrowserWindow, app, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppPath } from './appPath';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { hardenSession, hardenWebContents } from './security';
import { loadWindowState, trackWindowState } from './windowState';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(here, '../renderer');
const APP_ORIGIN = 'app://local';
const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const devOrigin = devUrl === undefined ? undefined : new URL(devUrl).origin;

// Test hooks (used by e2e): separate profile, and a hidden window so tests never steal focus.
const userDataOverride = process.env['OUTBREAKSCOPE_USER_DATA'];
if (userDataOverride !== undefined && userDataOverride !== '')
  app.setPath('userData', userDataOverride);
const hidden = process.env['OUTBREAKSCOPE_HIDDEN'] === '1';

// Strict CSP: only our own files, no inline script/style, no network, workers from 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "worker-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** True if a URL belongs to this app (app://local, or the Vite dev server in development). */
function isAppUrl(url: string): boolean {
  return (
    url.startsWith(APP_ORIGIN + '/') || (devOrigin !== undefined && url.startsWith(devOrigin + '/'))
  );
}

let mainWindow: BrowserWindow | undefined;

/** Creates the single main window with the locked-down web preferences. */
function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'OutbreakScope',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(here, '../preload/preload.cjs'),
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  trackWindowState(win);
  hardenWebContents(win.webContents, isAppUrl);
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  win.on('closed', () => {
    mainWindow = undefined;
  });
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    if (hidden) app.dock?.hide(); // macOS: keep test runs out of the Dock and out of the user's way
    hardenSession(devOrigin);
    protocol.handle('app', async (request) => {
      const file = resolveAppPath(rendererRoot, new URL(request.url).pathname);
      if (file === null) return new Response('Forbidden', { status: 403 });
      try {
        const body = await readFile(file);
        return new Response(new Uint8Array(body), {
          headers: {
            'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
            'content-security-policy': CSP,
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    registerIpc(isAppUrl);
    installMenu(() => mainWindow);
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

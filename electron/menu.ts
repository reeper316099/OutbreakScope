// Native application menu. Menu clicks become typed MenuAction events delivered to the renderer.
import { Menu, app, shell } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { MENU_ACTIONS, MENU_EVENT_NAME } from '../src/shared/types';
import type { MenuAction } from '../src/shared/types';

const REPO_URL = 'https://github.com/reeper316099/OutbreakScope';

/** Delivers a menu action to the page. The payload is JSON-encoded from a fixed list, never from user text. */
function sendAction(win: BrowserWindow | undefined, action: MenuAction): void {
  if (win === undefined || win.isDestroyed() || !MENU_ACTIONS.includes(action)) return;
  const code = `window.dispatchEvent(new CustomEvent(${JSON.stringify(MENU_EVENT_NAME)}, { detail: ${JSON.stringify(action)} }));`;
  void win.webContents.executeJavaScript(code);
}

/** Builds and installs the menu (File / View / Help, plus the app menu on macOS). */
export function installMenu(getWindow: () => BrowserWindow | undefined): void {
  const act = (action: MenuAction) => (): void => sendAction(getWindow(), action);
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Scenario…', accelerator: 'CmdOrCtrl+O', click: act('file:open-scenario') },
        { label: 'Open CSV…', accelerator: 'CmdOrCtrl+Shift+O', click: act('file:open-csv') },
        { label: 'Save Scenario…', accelerator: 'CmdOrCtrl+S', click: act('file:save-scenario') },
        { type: 'separator' },
        { label: 'Export CSV…', accelerator: 'CmdOrCtrl+E', click: act('file:export-csv') },
        { label: 'Export PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: act('file:export-png') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Simulator', accelerator: 'CmdOrCtrl+1', click: act('view:simulator') },
        { label: 'How this works', accelerator: 'CmdOrCtrl+2', click: act('view:explainer') },
        { label: 'Fit to data', accelerator: 'CmdOrCtrl+3', click: act('view:fit') },
        { label: 'About', accelerator: 'CmdOrCtrl+4', click: act('view:about') },
        { type: 'separator' },
        { label: 'Toggle Dark Mode', accelerator: 'CmdOrCtrl+D', click: act('view:toggle-dark') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' } as MenuItemConstructorOptions,
              { role: 'toggleDevTools' } as MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About OutbreakScope', click: act('view:about') },
        { label: 'Data sources', click: act('view:about') },
        { type: 'separator' },
        { label: 'GitHub repository', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report an issue', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

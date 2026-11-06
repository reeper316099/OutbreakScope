// Sandboxed preload: exposes exactly four functions to the renderer and nothing else.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../src/shared/types';
import type {
  AppInfo,
  OpenExternalResult,
  OpenFileResult,
  OutbreakScopeApi,
  SaveFileResult,
} from '../src/shared/types';

// invoke() returns Promise<any>; the casts below are safe because the main process returns these exact
// types and the renderer treats results as untrusted input anyway (file text is zod-validated).
const api: OutbreakScopeApi = {
  openFile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.openFile, request) as Promise<OpenFileResult>,
  saveFile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveFile, request) as Promise<SaveFileResult>,
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<OpenExternalResult>,
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('outbreakscope', api);

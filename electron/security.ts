// Session/window hardening: no network, no popups, no navigation away, no permissions.
import { session, shell } from 'electron';
import type { WebContents } from 'electron';
import { isAllowedExternalUrl } from './allowlist';

/** Cancels every http(s)/ws(s)/ftp request except the Vite dev server (dev only); denies all permission prompts. */
export function hardenSession(devOrigin: string | undefined): void {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
    (details, callback) => {
      const allowed = devOrigin !== undefined && new URL(details.url).origin === devOrigin;
      callback({ cancel: !allowed });
    },
  );
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/** Blocks new windows and navigation away from the app; allowlisted https links open in the system browser instead. */
export function hardenWebContents(contents: WebContents, isAppUrl: (url: string) => boolean): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

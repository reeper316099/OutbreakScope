import type { MenuAction, OutbreakScopeApi } from './shared/types';

declare global {
  interface Window {
    /** Exposed by the sandboxed preload script (electron/preload.ts). */
    outbreakscope: OutbreakScopeApi;
  }
  interface WindowEventMap {
    /** Must match MENU_EVENT_NAME in src/shared/types.ts. */
    'outbreakscope:menu': CustomEvent<MenuAction>;
  }
}

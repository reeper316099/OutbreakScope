// Renderer bootstrap: view router (simulator / explainer / fit / about), menu events, and shell self-checks.
import { MENU_EVENT_NAME } from './shared/types';
import type { MenuAction } from './shared/types';
import { pingWorker } from './ui/workerPing';

type ViewId = 'simulator' | 'explainer' | 'fit' | 'about';
const VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: 'simulator', label: 'Simulator' },
  { id: 'explainer', label: 'How this works' },
  { id: 'fit', label: 'Fit to data' },
  { id: 'about', label: 'About' },
];

/** Shows one view and marks its rail button as current. */
function showView(id: ViewId): void {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
    el.hidden = el.dataset['view'] !== id;
  });
  document.querySelectorAll<HTMLButtonElement>('#rail button').forEach((b) => {
    if (b.dataset['target'] === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

/** Builds the left-rail view switcher. */
function buildRail(): void {
  const rail = document.getElementById('rail');
  if (rail === null) return;
  for (const v of VIEWS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v.label;
    b.dataset['target'] = v.id;
    b.addEventListener('click', () => showView(v.id));
    rail.appendChild(b);
  }
}

/** Flips light/dark (persistence arrives with the typed storage layer in Phase 4). */
function toggleDark(): void {
  const root = document.documentElement;
  root.dataset['theme'] = root.dataset['theme'] === 'dark' ? 'light' : 'dark';
}

/** Routes native menu actions; file actions are wired up in later phases. */
function onMenuAction(action: MenuAction): void {
  switch (action) {
    case 'view:simulator':
      showView('simulator');
      break;
    case 'view:explainer':
      showView('explainer');
      break;
    case 'view:fit':
      showView('fit');
      break;
    case 'view:about':
      showView('about');
      break;
    case 'view:toggle-dark':
      toggleDark();
      break;
    default:
      break; // file actions: not implemented in the shell
  }
}

/** Adds a self-check line to the shell card. */
function addCheck(id: string, ok: boolean, text: string): void {
  const list = document.getElementById('checks');
  if (list === null) return;
  const li = document.createElement('li');
  li.id = id;
  li.dataset['mark'] = ok ? '[ok]' : '[FAIL]';
  li.dataset['ok'] = String(ok);
  li.textContent = text;
  list.appendChild(li);
}

/** Runs the shell self-checks: preload API, no Node access, worker under CSP. */
async function selfChecks(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  addCheck(
    'check-no-node',
    typeof g['require'] === 'undefined' && typeof g['process'] === 'undefined',
    'Renderer has no require/process',
  );
  const keys = Object.keys(window.outbreakscope).sort().join(',');
  addCheck(
    'check-api',
    keys === 'getAppInfo,openExternal,openFile,saveFile',
    `Preload API surface: ${keys}`,
  );
  const info = await window.outbreakscope.getAppInfo();
  addCheck(
    'check-info',
    info.name.length > 0,
    `App ${info.name} ${info.version} (Electron ${info.electron}, ${info.platform})`,
  );
  const aboutInfo = document.getElementById('about-info');
  if (aboutInfo !== null)
    aboutInfo.textContent = `Version ${info.version} · Electron ${info.electron} · Chromium ${info.chrome}`;
  const ping = await pingWorker(21);
  addCheck(
    'check-worker',
    ping.status === 'done' && ping.result === 42,
    `Worker round-trip: ${ping.status === 'done' ? String(ping.result) : ping.status}`,
  );
}

buildRail();
showView('simulator');
window.addEventListener(MENU_EVENT_NAME, (event) => onMenuAction(event.detail));
void selfChecks();

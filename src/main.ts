// Renderer bootstrap: view router with back/forward, menu events, keyboard shortcuts, theme, and shell self-checks.
import { MENU_EVENT_NAME } from './shared/types';
import type { AppInfo, MenuAction } from './shared/types';
import { renderAbout } from './ui/about';
import { byId, h } from './ui/dom';
import { renderExplainer } from './ui/explainer';
import { History } from './ui/history';
import { initFitView } from './ui/fitView';
import { initSimulator } from './ui/simulator';
import { ScenarioStore } from './ui/store';
import { initTheme, toggleTheme } from './ui/theme';
import { pingWorker } from './ui/workerPing';

type ViewId = 'simulator' | 'explainer' | 'fit' | 'about';
const VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: 'simulator', label: 'Simulator' },
  { id: 'explainer', label: 'How this works' },
  { id: 'fit', label: 'Fit to data' },
  { id: 'about', label: 'About' },
];

initTheme();
const api = window.outbreakscope;
const store = new ScenarioStore();
const nav = new History<ViewId>('simulator', 50);
let appInfo: AppInfo | null = null;
let toastTimer = 0;

/** Shows a short message in the status bar (errors stay longer). */
function notify(message: string, kind: 'info' | 'error' = 'info'): void {
  const el = byId('toast');
  el.textContent = message;
  el.dataset['kind'] = kind;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.textContent = ''), kind === 'error' ? 12000 : 5000);
}

const sim = initSimulator(store, api, () => appInfo?.version ?? 'dev', notify);
const fit = initFitView(api, notify, () => appInfo?.version ?? 'dev');

/** Shows one view, renders it if it is generated, and marks its rail button as current. */
function showView(id: ViewId, record = true): void {
  if (record && nav.value !== id) nav.push(id);
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
    el.hidden = el.dataset['view'] !== id;
  });
  document.querySelectorAll<HTMLButtonElement>('#rail button').forEach((b) => {
    if (b.dataset['target'] === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (id === 'explainer') renderExplainer(byId('view-explainer'), store.scenario);
  if (id === 'about')
    renderAbout(
      byId('view-about'),
      appInfo,
      (url) => void api.openExternal(url).then((r) => !r.ok && notify(r.message, 'error')),
    );
  if (id === 'simulator') sim.redraw();
  byId<HTMLButtonElement>('btn-nav-back').disabled = !nav.canUndo;
  byId<HTMLButtonElement>('btn-nav-forward').disabled = !nav.canRedo;
}

/** Builds the left-rail view switcher. */
function buildRail(): void {
  const rail = byId('rail');
  for (const v of VIEWS) {
    const b = h('button', { type: 'button', 'data-target': v.id }, v.label);
    b.addEventListener('click', () => showView(v.id));
    rail.appendChild(b);
  }
}

/** Switches theme and redraws charts so their colours follow. */
function onToggleTheme(): void {
  toggleTheme();
  sim.redraw();
  fit.redraw();
}

/** Routes native menu actions and shortcuts. */
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
      onToggleTheme();
      break;
    case 'file:save-scenario':
      void sim.saveScenarioFile();
      break;
    case 'file:open-scenario':
      void sim.openScenarioFile();
      break;
    case 'file:export-csv':
      void (nav.value === 'fit' ? fit.exportCsv() : sim.exportCsv());
      break;
    case 'file:export-png':
      void (nav.value === 'fit' ? fit.exportPng() : sim.exportPng());
      break;
    case 'file:open-csv':
      showView('fit');
      void fit.openCsv();
      break;
  }
}

/** True if a keystroke is going into a text-like field (so shortcuts must not hijack it). */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'text');
}

/** Keyboard shortcuts handled in the page: undo/redo, view history, Space to run/cancel. */
function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typingInField(e.target)) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const v = e.key === 'ArrowLeft' ? nav.undo() : nav.redo();
    if (v !== undefined) showView(v, false);
  } else if (
    e.key === ' ' &&
    !mod &&
    !e.altKey &&
    e.target === document.body &&
    nav.value === 'simulator'
  ) {
    e.preventDefault();
    sim.toggleRun();
  }
}

/** Adds a self-check line (used by end-to-end tests). */
function addCheck(id: string, ok: boolean, text: string): void {
  const li = h('li', { id, 'data-ok': String(ok) }, `${ok ? '[ok]' : '[FAIL]'} ${text}`);
  byId('checks').appendChild(li);
}

/** Runs the shell self-checks: preload API, no Node access, worker under CSP. */
async function selfChecks(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  addCheck(
    'check-no-node',
    typeof g['require'] === 'undefined' && typeof g['process'] === 'undefined',
    'Renderer has no require/process',
  );
  const keys = Object.keys(api).sort().join(',');
  addCheck(
    'check-api',
    keys === 'getAppInfo,openExternal,openFile,saveFile',
    `Preload API surface: ${keys}`,
  );
  appInfo = await api.getAppInfo();
  document.title = 'OutbreakScope';
  const ping = await pingWorker(21);
  addCheck(
    'check-worker',
    ping.status === 'done' && ping.result === 42,
    `Worker round-trip: ${ping.status === 'done' ? String(ping.result) : ping.status}`,
  );
}

buildRail();
byId('btn-theme').addEventListener('click', onToggleTheme);
byId('btn-nav-back').addEventListener('click', () => {
  const v = nav.undo();
  if (v !== undefined) showView(v, false);
});
byId('btn-nav-forward').addEventListener('click', () => {
  const v = nav.redo();
  if (v !== undefined) showView(v, false);
});
showView('simulator', false);
window.addEventListener(MENU_EVENT_NAME, (event) => onMenuAction(event.detail));
window.addEventListener('keydown', onKey);
store.subscribe(() => {
  if (!byId('view-explainer').hidden) renderExplainer(byId('view-explainer'), store.scenario);
});
void selfChecks();

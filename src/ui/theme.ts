// Light/dark theme: defaults to the OS preference, remembered through the typed storage layer.
import { loadPreferences, savePreferences } from '../io/storage';

export type Theme = 'light' | 'dark';

/** The theme currently applied to the page. */
export function currentTheme(): Theme {
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
}

/** Applies a theme to the page (and optionally remembers it). */
export function applyTheme(theme: Theme, remember: boolean): void {
  document.documentElement.dataset['theme'] = theme;
  if (remember) savePreferences({ theme });
}

/** Sets the initial theme from saved preference, else from the OS setting. */
export function initTheme(): void {
  const saved = loadPreferences().theme;
  const os: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved ?? os, false);
}

/** Flips light/dark, remembers the choice, and returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
  return next;
}

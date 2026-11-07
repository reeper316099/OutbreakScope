// Typed preference storage on top of localStorage (validated with zod; every access is guarded).
import { preferencesSchema } from '../shared/schemas';
import type { Preferences } from '../shared/schemas';

const KEY = 'outbreakscope.preferences.v1';

/** Reads saved preferences, returning {} if storage is unavailable, empty or corrupted. */
export function loadPreferences(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): Preferences {
  try {
    const text = storage?.getItem(KEY);
    if (!text) return {};
    const parsed = preferencesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Merges and saves preferences; failures (private mode, quota) are ignored on purpose. */
export function savePreferences(
  patch: Preferences,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...loadPreferences(storage), ...patch }));
  } catch {
    /* preferences are a convenience, not required */
  }
}

/** Returns localStorage if the browser allows it, otherwise undefined. */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

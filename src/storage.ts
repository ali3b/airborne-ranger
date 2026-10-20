/**
 * G11: the game was renamed to Solitary Strike, and its localStorage keys moved from the `ar.` prefix to `ss.`.
 * `readKey` reads the new key; when it is missing it falls back to the old `ar.` key and copies the value over, so a
 * player's roster, difficulty, last loadout and mute setting survive the rename. The old key is left in place.
 */
const PREFIX = 'ss.';
const OLD_PREFIX = 'ar.';

/** The stored value of `key` (an `ss.` key), migrating it from the old `ar.` key the first time. Throws like localStorage. */
export function readKey(key: string): string | null {
  const v = localStorage.getItem(key);
  if (v !== null || !key.startsWith(PREFIX)) return v;
  const old = localStorage.getItem(OLD_PREFIX + key.slice(PREFIX.length));
  if (old === null) return null;
  try {
    localStorage.setItem(key, old);
  } catch {
    /* storage full or blocked: keep reading the old key */
  }
  return old;
}

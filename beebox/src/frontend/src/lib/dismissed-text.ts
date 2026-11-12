/**
 * A line of text the person hid on this device "until it changes": the hidden
 * text is kept in browser storage under one key, and the line stays hidden
 * while the current text, trimmed, equals what was stored. New text shows
 * again without anyone clearing the key.
 *
 * Storage has the same guard as `stored-flag.ts`: it can be absent (server
 * render) or throw on access (private mode, blocked site data), and hiding is
 * only a convenience, so every read failure reads as not hidden and a write
 * that fails is dropped. The storage is a getter because merely naming
 * `localStorage` can throw.
 */

export type TextStorage = Pick<Storage, "getItem" | "setItem">;

export interface DismissedText {
  /** Returns the storage to use, or null when there is none (server render). */
  storage: () => TextStorage | null;
  key: string;
}

/** Whether `text` is hidden by the `stored` value; blank text is never hidden. */
export function isDismissed({ stored, text }: { stored: string | null; text: string }): boolean {
  const trimmed = text.trim();
  return stored !== null && trimmed !== "" && stored === trimmed;
}

/** The stored text, or null when none is stored or storage fails. */
export function readDismissedText(entry: DismissedText): string | null {
  try {
    return entry.storage()?.getItem(entry.key) ?? null;
  } catch (_e) {
    return null;
  }
}

/** Store `text`, trimmed, as hidden. Returns whether the write reached storage. */
export function writeDismissedText(entry: DismissedText, text: string): boolean {
  try {
    const storage = entry.storage();
    if (storage === null) return false;
    storage.setItem(entry.key, text.trim());
    return true;
  } catch (_e) {
    // storage unavailable or full: the caller keeps the hidden text for this load
    return false;
  }
}

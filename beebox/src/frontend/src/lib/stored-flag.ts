/**
 * A boolean flag kept in browser storage as "1" / "0". Storage can be absent
 * (server render) or throw on access (private mode, blocked site data), and a
 * flag is only a convenience, so every failure reads as off and a write that
 * fails is dropped.
 *
 * The storage is a getter because merely naming `localStorage` can throw; the
 * getter keeps that access inside the guard.
 */

export type FlagStorage = Pick<Storage, "getItem" | "setItem">;

export interface StoredFlag {
  /** Returns the storage to use, or null when there is none (server render). */
  storage: () => FlagStorage | null;
  key: string;
}

export function readStoredFlag(flag: StoredFlag): boolean {
  try {
    return flag.storage()?.getItem(flag.key) === "1";
  } catch (_e) {
    return false;
  }
}

export function writeStoredFlag(flag: StoredFlag, on: boolean): void {
  try {
    flag.storage()?.setItem(flag.key, on ? "1" : "0");
  } catch (_e) {
    // storage unavailable: the flag lives for this load only
  }
}

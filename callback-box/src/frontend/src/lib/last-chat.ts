/**
 * The chat you came from — what the app bar's "back to chat" chip returns to.
 *
 * Getting from a chat into a card or the browse view has several routes;
 * getting back had none. The app bar deliberately has no link row
 * (`AppNav.tsx`, `docs/plans/top-nav-ia.md` Track C), and the place-switch
 * menu is a different promise: it moves between landmarks and resumes each
 * one's *newest* chat, which need not be the one you left. Nothing carried the
 * session you left, though the chat is addressable (`?session=<id>`) and so
 * the information existed. This module carries it.
 *
 * **Per tab, per box, and deliberately not durable.** `sessionStorage` is the
 * right lifetime: "the chat I was just in" is a property of this tab's trip
 * through the app, not of the box. A second tab opened on a card page offers
 * no back chip, which is correct — you did not come from a chat there. A
 * reload of the card page keeps it, which is also correct.
 *
 * A module-level listener set backs `useLastChat` rather than a context: the
 * writer (`ChatBarChrome`, deep inside the chat page) and the reader
 * (`AppNav`, above the route outlet) share no subtree, and the value changes
 * about once per navigation — a `useSyncExternalStore` is cheaper than
 * threading another provider through the shell.
 */

import { useSyncExternalStore } from "react";

/** A chat worth returning to: its id, and what to call it. */
export interface LastChat {
  sessionId: string;
  /** The session's name, or null before the chat has been titled. */
  label: string | null;
}

const listeners = new Set<() => void>();

function storageKey(boxSlug: string): string {
  return `cb:last-chat:${boxSlug}`;
}

/**
 * Cached per box so `getSnapshot` returns a stable reference between writes —
 * `useSyncExternalStore` re-renders forever if it parses a new object each
 * call. `undefined` means "not read from storage yet".
 */
const snapshots = new Map<string, LastChat | null>();

/**
 * The tab's session storage, or null where there is none — `cb render`'s
 * server pass, and a browser set to block site data, which throws on the
 * *accessor* rather than on the read. Resolved per call rather than cached:
 * the doctests substitute one, and nothing here is hot.
 */
function sessionStore(): Storage | null {
  try {
    // `in`, not `?? null`: the DOM lib types `globalThis.sessionStorage` as
    // always present, so a nullish check is dead code to the type system —
    // but `cb render`'s server pass really has no such global.
    if (!("sessionStorage" in globalThis)) return null;
    return globalThis.sessionStorage;
  } catch (e) {
    console.warn("[last-chat] sessionStorage unavailable", e);
    return null;
  }
}

function readStorage(boxSlug: string): LastChat | null {
  const store = sessionStore();
  if (store === null) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(storageKey(boxSlug));
  } catch (e) {
    // A missing back chip is the right degradation for a storage that reads
    // but refuses.
    console.warn("[last-chat] could not read the chat to return to", e);
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record: Record<string, unknown> = { ...parsed };
    const sessionId = record["sessionId"];
    const label = record["label"];
    if (typeof sessionId !== "string" || sessionId === "") return null;
    return { sessionId, label: typeof label === "string" ? label : null };
  } catch (e) {
    console.warn("[last-chat] discarding unreadable stored chat", e);
    return null;
  }
}

/**
 * The chat to return to in this box, or null if this tab has not been in one.
 * `useLastChat` is the React face of this; the plain function is what the
 * doctests read and what any non-component caller should use.
 */
export function readLastChat(boxSlug: string): LastChat | null {
  const cached = snapshots.get(boxSlug);
  if (cached !== undefined) return cached;
  const value = readStorage(boxSlug);
  snapshots.set(boxSlug, value);
  return value;
}

/**
 * Record the chat this tab is in, so leaving it for a card or browse page
 * leaves a way back. A no-op when nothing changed, so the chat page can call
 * it on every render of a streamed turn without waking the bar.
 */
export function rememberLastChat(boxSlug: string, chat: LastChat): void {
  const current = readLastChat(boxSlug);
  if (current !== null && current.sessionId === chat.sessionId && current.label === chat.label) return;
  snapshots.set(boxSlug, chat);
  try {
    sessionStore()?.setItem(storageKey(boxSlug), JSON.stringify(chat));
  } catch (e) {
    // The chip still works for this page's lifetime from the in-memory
    // snapshot; only surviving a reload is lost.
    console.warn("[last-chat] could not persist the chat to return to", e);
  }
  for (const listener of listeners) listener();
}

/** Hear about every change to any box's remembered chat. Returns the detach. */
export function subscribeToLastChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** {@link readLastChat}, wired to re-render on {@link rememberLastChat}. */
export function useLastChat(boxSlug: string): LastChat | null {
  return useSyncExternalStore(
    subscribeToLastChat,
    () => readLastChat(boxSlug),
    // SSR (`cb render`) has no sessionStorage and no navigation history.
    () => null,
  );
}

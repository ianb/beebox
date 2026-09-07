/**
 * Remembering the sidecar's open documents across a reload.
 *
 * `sessionStorage`, per browser tab, per box, per conversation — the same
 * reasoning as `lib/last-chat.ts`: the strip is a property of this tab's trip
 * through the app, not of the box. Two conversations open in two browser tabs
 * each keep their own; nothing follows you to another device, and closing the
 * tab ends it.
 *
 * A stored strip is untrusted input by the time it is read back (a previous
 * bundle wrote it, or a person edited it), so every entry is re-parsed through
 * `parseViewUrl` and a bad one is dropped on its own rather than taking the
 * strip with it (engineering principle 3).
 */

import { isRecord } from "@shared/is-record";
import { parseViewUrl, serializeViewUrl } from "../../lib/view-url";
import { EMPTY_SIDECAR, type SidecarState, type SidecarTab } from "./sidecar-tabs";

const KEY_PREFIX = "bbx:sidecar-tabs";

/**
 * `sessionInput` is the chat's own identity: an existing session id, or the
 * literal "new" before the first turn assigns one
 * (`InteractiveChat.tsx` — `sessionInput`).
 */
export function sidecarTabsKey({ boxSlug, sessionInput }: { boxSlug: string | undefined; sessionInput: string }): string {
  return `${KEY_PREFIX}:${boxSlug ?? "default"}:${sessionInput}`;
}

/**
 * sessionStorage is absent under SSR (`bbx render`) and throws rather than
 * missing in a browser told to block site data. Both mean "no memory", not
 * "fail" — the sidecar simply starts empty.
 */
function sessionStore(): Storage | null {
  try {
    if (!("sessionStorage" in globalThis)) return null;
    return globalThis.sessionStorage;
  } catch (e) {
    console.warn(`[sidecar-tabs] sessionStorage unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function serializeSidecarState(state: SidecarState): string {
  return JSON.stringify({
    v: 1,
    activePath: state.activePath,
    tabs: state.tabs.map((t) => ({
      url: serializeViewUrl(t.target),
      label: t.label,
      pinned: t.pinned,
      lastActiveAt: t.lastActiveAt,
    })),
  });
}

function parseTab(value: unknown): SidecarTab | null {
  if (!isRecord(value)) return null;
  const { url, label, pinned, lastActiveAt } = value;
  if (typeof url !== "string" || url === "") return null;
  const target = parseViewUrl(url);
  if (target.path === "") return null;
  return {
    target,
    label: typeof label === "string" && label !== "" ? label : target.path,
    pinned: pinned === true,
    lastActiveAt: typeof lastActiveAt === "number" && Number.isFinite(lastActiveAt) ? lastActiveAt : 0,
  };
}

/** Parse a stored strip, dropping whatever no longer makes sense. */
export function parseSidecarState(raw: string | null): SidecarState | null {
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    console.warn(`[sidecar-tabs] discarding unparseable strip: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value["tabs"])) return null;
  const parsed = value["tabs"].map(parseTab).filter((t): t is SidecarTab => t !== null);
  // One tab per path is an invariant of the strip (the reducer, the React keys,
  // and every action look tabs up by path). A hand-edited or double-written
  // store could carry the same path twice, which would render two tabs that act
  // as one; keep the last, which is the more recently written.
  const tabs = [...new Map(parsed.map((t) => [t.target.path, t])).values()];
  if (tabs.length === 0) return null;
  // An active path naming a tab that did not survive the parse would leave the
  // pane rendering nothing; fall back to the last tab, which is where an open
  // leaves you.
  const stored = value["activePath"];
  const activePath = typeof stored === "string" && tabs.some((t) => t.target.path === stored)
    ? stored
    : (tabs.at(-1)?.target.path ?? null);
  return { tabs, activePath };
}

export function loadSidecarState(key: string): SidecarState | null {
  const store = sessionStore();
  if (store === null) return null;
  try {
    return parseSidecarState(store.getItem(key));
  } catch (e) {
    console.warn(`[sidecar-tabs] could not read the stored strip: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Persist — best effort. Losing the strip across a reload is a lost
 * convenience, never a reason to interrupt what the person is doing.
 */
export function saveSidecarState(key: string, state: SidecarState): void {
  const store = sessionStore();
  if (store === null) return;
  try {
    if (state.tabs.length === 0) store.removeItem(key);
    else store.setItem(key, serializeSidecarState(state));
  } catch (e) {
    console.warn(`[sidecar-tabs] could not persist the strip: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Move a strip from one key to another. A chat opened as "new" gets its real
 * session id once the first turn lands, and the documents opened while
 * composing that message belong to the conversation it started.
 */
export function moveSidecarState({ from, to }: { from: string; to: string }): void {
  const store = sessionStore();
  if (store === null || from === to) return;
  try {
    const raw = store.getItem(from);
    if (raw === null) return;
    store.setItem(to, raw);
    store.removeItem(from);
  } catch (e) {
    console.warn(`[sidecar-tabs] could not move the stored strip: ${e instanceof Error ? e.message : String(e)}`);
  }
}


export interface SessionSidecar {
  storageKey: string;
  logicalKey: string;
  panel: SidecarState;
}

/** A rename carries the panel; explicit focus loads that conversation's panel. */
export function selectSidecarSession(previous: SessionSidecar, next: Omit<SessionSidecar, "panel">): SessionSidecar {
  if (previous.storageKey === next.storageKey) return previous;
  return { ...next, panel: previous.logicalKey === next.logicalKey
    ? previous.panel : loadSidecarState(next.storageKey) ?? EMPTY_SIDECAR };
}

/** Called after flushing the old scheduled write, before changing its mirrors. */
export function persistSidecarTransition(previous: SessionSidecar, next: Omit<SessionSidecar, "panel">): void {
  saveSidecarState(previous.storageKey, previous.panel);
  if (previous.logicalKey === next.logicalKey) {
    moveSidecarState({ from: previous.storageKey, to: next.storageKey });
  }
}

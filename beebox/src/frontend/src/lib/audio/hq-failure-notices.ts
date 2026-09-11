/**
 * Persistent notices for HQ transcription failures that will not fix
 * themselves (`docs/plans/resilient-voice-recording.md`, Track 4) — e.g. a
 * missing OpenRouter key. One notice per `(service, code)` until the user
 * dismisses it; a dismissal is remembered per box in `localStorage`, so the
 * same failure does not nag on every message. The voice chip renders them.
 */

import { getApiBase } from "../../api-core";
import type { HqFailure } from "./hq-wait";

export interface HqFailureNotice {
  /** `<service>:<code>` — the dismissal key. */
  key: string;
  message: string;
}

type Listener = () => void;

let notices: readonly HqFailureNotice[] = [];
const listeners = new Set<Listener>();

function storageKey(): string {
  return `bbx:hq-failure-dismissed:${getApiBase()}`;
}

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch (e) {
    console.warn("[hq-failure-notices] Cannot read dismissed notices:", e);
    return [];
  }
}

function publish(next: readonly HqFailureNotice[]): void {
  notices = next;
  for (const listener of listeners) listener();
}

/** Show a permanent HQ failure once per (service, code), unless dismissed before. */
export function recordHqFailureNotice(opts: { service: string | null; failure: HqFailure }): void {
  const { service, failure } = opts;
  const key = `${service ?? "hq"}:${failure.code}`;
  if (notices.some((n) => n.key === key) || readDismissed().includes(key)) return;
  publish([...notices, { key, message: failure.message }]);
}

export const hqFailureNotices = {
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): readonly HqFailureNotice[] => notices,
  dismiss: (key: string): void => {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify([...new Set([...readDismissed(), key])]));
    } catch (e) {
      console.warn("[hq-failure-notices] Cannot remember the dismissal:", e);
    }
    publish(notices.filter((n) => n.key !== key));
  },
};

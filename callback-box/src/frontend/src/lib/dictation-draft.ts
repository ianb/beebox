/**
 * Pure helpers for the interrupted-dictation draft that the chat persists to
 * localStorage. The hook (`useDictationDraft`) owns the storage I/O and React
 * state; this module owns the key shape, the serialize/parse boundary, and the
 * age formatting so they can be unit-tested without a DOM.
 *
 * A draft is the realtime transcript captured mid-dictation. It's written
 * continuously while the user speaks so a screen sleep, tab eviction, or reload
 * can't erase the whole in-progress transcript (the original feedback). On
 * recovery the text is surfaced in a dedicated widget — not auto-filled into
 * the composer — and submitted as a narration `<speech>` message.
 *
 * Since chunk 4 (docs/plans/input-extraction.md) the key is a singleton per
 * box, not per session — matching the composer's singleton-draft decision:
 * the mic is one instrument, not a per-conversation buffer. The one-shot
 * `adoptLegacyDictationDrafts` mirrors `adoptLegacyComposerDrafts`
 * (`input/emission-persist.ts`): the most-recently-updated legacy
 * `cb-chat-draft:<box>:<session>` draft becomes the singleton value, and all
 * of that box's legacy keys are removed either way.
 */

import type { KeyValueStorage } from "../input/emission-persist";

const KEY_PREFIX = "cb-chat-draft";

export interface DictationDraft {
  /** The realtime transcript captured so far (trimmed, non-empty). */
  text: string;
  /** Whether narration mode was on when this was captured — drives framing on submit. */
  narration: boolean;
  /** Epoch ms of the last write, for the "captured N ago" label and staleness. */
  updatedAt: number;
}

/**
 * localStorage key for a box's dictation draft — one singleton slot per box,
 * not per session (mirrors the composer's `emissionKey`). The box slug scopes
 * drafts so two boxes open in different tabs don't collide.
 */
export function draftKey(opts: { boxSlug: string | undefined }): string {
  const box = opts.boxSlug ?? "default";
  return `${KEY_PREFIX}:${box}:singleton`;
}

/**
 * One-shot adoption of the legacy per-session dictation drafts
 * (`cb-chat-draft:<box>:<session>`): the most-recently-updated draft becomes
 * the seed value; ALL of the box's legacy keys are removed. The singleton
 * key itself is never a candidate — the new key shares the legacy prefix
 * (unlike the composer's migration, which changed prefixes), and adoption
 * must not be able to delete the very slot it writes to. Returns the
 * adopted draft (or null) plus how many were discarded.
 */
export function adoptLegacyDictationDrafts(
  storage: KeyValueStorage,
  boxSlug: string | undefined,
): { adopted: DictationDraft | null; discarded: number } {
  const box = boxSlug ?? "default";
  const prefix = `${KEY_PREFIX}:${box}:`;
  const singleton = draftKey({ boxSlug });
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(prefix) && key !== singleton) keys.push(key);
  }

  let best: DictationDraft | null = null;
  let count = 0;
  for (const key of keys) {
    const draft = parseDraft(storage.getItem(key));
    if (draft === null) continue;
    count++;
    if (best === null || draft.updatedAt > best.updatedAt) best = draft;
  }
  for (const key of keys) storage.removeItem(key);

  return { adopted: best, discarded: best === null ? count : count - 1 };
}

/**
 * Parse a stored draft, returning null for absent, malformed, or empty-text
 * values. The parse boundary is the only place untrusted JSON enters, so it
 * validates the full shape rather than trusting the cast.
 */
export function parseDraft(raw: string | null): DictationDraft | null {
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    console.warn(`[dictation-draft] discarding unparseable draft: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  // Parse boundary: localStorage JSON arrives untyped. Every field is
  // validated below before the typed object is returned.
  const record = value as Record<string, unknown>;
  const { text, narration, updatedAt } = record;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (typeof narration !== "boolean") return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  return { text, narration, updatedAt };
}

export function serializeDraft(draft: DictationDraft): string {
  return JSON.stringify(draft);
}

/**
 * Human-readable age of a draft: "just now", "3 min ago", "2 hr ago",
 * "4 days ago". Takes the elapsed milliseconds so the caller owns the clock
 * (and tests stay deterministic).
 */
export function formatDraftAge(elapsedMs: number): string {
  const sec = Math.floor(elapsedMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

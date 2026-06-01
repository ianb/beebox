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
 */

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
 * localStorage key for a session's draft. New chats (no server-assigned id
 * yet) share the `:new` slot; resumed sessions key on their id. The box slug
 * scopes drafts so two boxes open in different tabs don't collide.
 */
export function draftKey(opts: { boxSlug: string | undefined; sessionId: string | null }): string {
  const box = opts.boxSlug ?? "default";
  const session = opts.sessionId ?? "new";
  return `${KEY_PREFIX}:${box}:${session}`;
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

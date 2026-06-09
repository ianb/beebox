/**
 * Pure helpers for the unsent-composer draft the chat persists to localStorage.
 * The typed text in the composer otherwise lives only in React state, so a
 * remount (the router re-reading search params on wake-from-sleep tears down
 * and rebuilds the chat) or a reload silently discards whatever wasn't sent.
 *
 * This is the typed sibling of `dictation-draft`: that one preserves an
 * in-flight *voice* transcript and surfaces it in a recovery widget; this one
 * preserves *typed* text and is auto-restored straight into the composer (it's
 * the same field — the user expects it to still be there). The hook
 * (`useComposerDraft`) owns the storage I/O and React state; this module owns
 * the key shape and the parse/serialize boundary so they're testable without a
 * DOM.
 */

const KEY_PREFIX = "cb-composer-draft";

export interface ComposerDraft {
  /** The unsent composer text (raw, non-blank). */
  text: string;
  /** Epoch ms of the last write, for restore-staleness pruning. */
  updatedAt: number;
}

/**
 * localStorage key for a session's composer draft. New chats (no server-
 * assigned id yet) share the `:new` slot; resumed sessions key on their id.
 * The box slug scopes drafts so two boxes open in different tabs don't collide.
 */
export function composerDraftKey(opts: { boxSlug: string | undefined; sessionId: string | null }): string {
  const box = opts.boxSlug ?? "default";
  const session = opts.sessionId ?? "new";
  return `${KEY_PREFIX}:${box}:${session}`;
}

/**
 * Parse a stored draft, returning null for absent, malformed, or blank-text
 * values. The parse boundary is the only place untrusted JSON enters, so it
 * validates the full shape rather than trusting the cast.
 */
export function parseComposerDraft(raw: string | null): ComposerDraft | null {
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    console.warn(`[composer-draft] discarding unparseable draft: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  // Parse boundary: localStorage JSON arrives untyped. Every field is
  // validated below before the typed object is returned.
  const record = value as Record<string, unknown>;
  const { text, updatedAt } = record;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  return { text, updatedAt };
}

export function serializeComposerDraft(draft: ComposerDraft): string {
  return JSON.stringify(draft);
}

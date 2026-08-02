/**
 * Span resolution for chat review — which slice of a transcript has not yet
 * been folded into a session's account.
 *
 * The journal records the *identity* of the last entry read (`endUuid`) plus a
 * hash of every uuid before it (`prefixHash`), not a numeric index. Index alone
 * cannot work: `parseSessionLog` numbers entries positionally within its scan
 * (`cli/lib/session-retention.ts`), so a transcript rewrite that replaces or
 * reorders earlier entries while keeping the total at or above the stored
 * index silently shifts the boundary — re-reading material already
 * folded in, or skipping material never seen. Transcripts are SDK-owned and do
 * get rewritten (auto-compaction, `--resume` forks), so this is a real case,
 * not a theoretical one.
 *
 * See docs/implemented-plans/chat-review.md § Track A.
 */

import type { SessionEntry } from "../../../cli/lib/session.js";
import { contentHash } from "../../../lib/content-hash.js";
import { renderEntries } from "../transcript-render.js";
import type { AppliedSpan } from "./state.js";

/** Why a span is being read from the top rather than continuing a journal. */
export type BootstrapReason = "no-journal" | "boundary-missing" | "prefix-rewritten";

/**
 * Why a span could not be resolved at all, so the session must be skipped for
 * this run rather than reviewed.
 *
 * `"boundary-beyond-window"`: the read was truncated (the transcript holds more
 * entries than the bounded read returned) AND the journal's boundary entry is
 * not in what we read — so the boundary almost certainly sits past the end of
 * the window, in the part of the file we never looked at. Bootstrapping there
 * would re-summarize ancient entries and then record a span whose `endIndex`
 * moves the journal BACKWARDS, permanently losing the real boundary.
 */
export type DeferralReason = "boundary-beyond-window";

export interface ResolvedSpan {
  /** Entries not yet folded into the account. Empty when nothing is new. */
  entries: SessionEntry[];
  /** Index of the last entry in `entries` within the full transcript, or -1 when empty. */
  endIndex: number;
  /**
   * Non-null when the journal could not be continued and the whole transcript
   * is the span. The caller warns on `boundary-missing`/`prefix-rewritten` —
   * those mean the transcript was rewritten under us.
   */
  bootstrap: BootstrapReason | null;
  /**
   * Non-null when the span is unresolvable and the session must be left
   * untouched this run (no husk write, no journal advance). Mutually exclusive
   * with `bootstrap`; `entries` is empty and `endIndex` is -1.
   */
  deferred: DeferralReason | null;
}

/**
 * sha256 over the uuid AND rendered content of every entry up to `endIndex`.
 *
 * Content matters, not just identity: the SDK can rewrite an entry's text while
 * keeping its uuid, and a uuid-only hash would call that history unchanged and
 * skip the rewritten material. Hashing what we actually read makes any edit
 * before the boundary a mismatch, which forces a re-read.
 */
export function prefixHash(entries: SessionEntry[], endIndex: number): string {
  const parts = entries
    .slice(0, endIndex + 1)
    .map((entry) => `${entry.uuid}\u0000${renderEntries([entry])}`);
  return contentHash(parts.join("\n"));
}

/**
 * The idempotency key for a span: stable across runs given the same session,
 * boundary entry, and preceding history. Written to the husk so a re-apply
 * after a crash between the card write and the journal write is detectable.
 */
export function computeSpanId(args: {
  sessionId: string;
  endUuid: string;
  prefixHash: string;
}): string {
  return contentHash([args.sessionId, args.endUuid, args.prefixHash].join("\n"));
}

export interface ResolveSpanArgs {
  /** The bounded read of the transcript — a first-page read, from the top. */
  entries: SessionEntry[];
  /** The last span applied to this session; null when there is none. */
  applied: AppliedSpan | null;
  /**
   * True when the transcript holds MORE entries than `entries` contains — i.e.
   * the read hit its cap. Load-bearing: it is the difference between "the
   * boundary is gone" and "we simply haven't looked far enough yet".
   */
  truncated: boolean;
}

/**
 * Locate the unread span, given a bounded read of the transcript and the last
 * span applied to this session.
 *
 * Bootstrap (whole window) happens when there is no journal entry, when the
 * recorded boundary entry is gone, or when the history before it no longer
 * hashes the same. The last two mean a rewrite: the caller keeps the existing
 * account, which is now the only surviving record of what was rewritten.
 *
 * A missing boundary in a TRUNCATED read is not a rewrite, though — it is the
 * ordinary consequence of a session growing past the read cap since the last
 * review, and bootstrapping on it is actively destructive (see
 * {@link DeferralReason}). That case defers instead.
 */
export function resolveSpan(args: ResolveSpanArgs): ResolvedSpan {
  const { entries, applied, truncated } = args;
  const bootstrapAll = (bootstrap: BootstrapReason): ResolvedSpan => ({
    entries,
    endIndex: entries.length - 1,
    bootstrap,
    deferred: null,
  });
  // Only reachable with a prior applied span, so it can never swallow the
  // legitimate first-ever review of an over-long session.
  const defer = (): ResolvedSpan => ({
    entries: [],
    endIndex: -1,
    bootstrap: null,
    deferred: "boundary-beyond-window",
  });

  if (applied === null) {
    return bootstrapAll("no-journal");
  }

  // `parseSessionLog` defaults a missing uuid to "" (cli/lib/session-entry.ts),
  // so an empty boundary is not an identity at all — several entries could
  // match it. Treat it as unusable rather than resolving to the wrong one.
  // (No uuid to search for, so truncation tells us nothing here.)
  if (applied.endUuid === "") {
    return bootstrapAll("boundary-missing");
  }
  const boundary = entries.findIndex((entry) => entry.uuid === applied.endUuid);
  if (boundary === -1) {
    return truncated ? defer() : bootstrapAll("boundary-missing");
  }
  if (prefixHash(entries, boundary) !== applied.prefixHash) {
    // The boundary IS in the window; only the history before it changed. That's
    // a genuine rewrite, and re-reading the window is the right response
    // whether or not the read was truncated.
    return bootstrapAll("prefix-rewritten");
  }

  return {
    entries: entries.slice(boundary + 1),
    endIndex: entries.length - 1,
    bootstrap: null,
    deferred: null,
  };
}

/**
 * How much new material a span holds, in the unit the size gate uses:
 * rendered characters **before** elision.
 *
 * The elided form cannot be used here. `renderSessionCompact` clamps its output
 * at MAX_RENDERED_CHARS, so a session past the cap reports a length that never
 * grows again — gating on it would stop reviewing exactly the long sessions
 * this subsystem exists for.
 */
export function spanSize(span: ResolvedSpan): number {
  return renderEntries(span.entries).length;
}

/** The journal entry to record once a span has been folded in. */
export function appliedSpanFor(args: {
  sessionId: string;
  entries: SessionEntry[];
  endIndex: number;
  now: Date;
}): AppliedSpan | null {
  const { sessionId, entries, endIndex, now } = args;
  const endEntry = entries[endIndex];
  // No boundary identity means no journal entry — the next run bootstraps,
  // which is correct-but-wasteful rather than silently wrong.
  if (endEntry === undefined || endEntry.uuid === "") return null;
  const prefix = prefixHash(entries, endIndex);
  return {
    spanId: computeSpanId({ sessionId, endUuid: endEntry.uuid, prefixHash: prefix }),
    endUuid: endEntry.uuid,
    endIndex,
    prefixHash: prefix,
    at: now.toISOString(),
  };
}

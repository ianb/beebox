/**
 * Span resolution for chat review — which slice of a transcript has not yet
 * been folded into a session's account.
 *
 * The journal records the *identity* of the last entry read (`endUuid`) plus a
 * hash of every entry before it (`prefixHash`), not a numeric index. Index
 * alone cannot work: `parseSessionLog` numbers entries positionally within its
 * scan (`cli/lib/session-retention.ts`), so a transcript rewrite that replaces
 * or reorders earlier entries while keeping the total at or above the stored
 * index silently shifts the boundary — re-reading material already folded in,
 * or skipping material never seen. Transcripts are SDK-owned and do get
 * rewritten (auto-compaction, `--resume` forks), so this is a real case, not a
 * theoretical one.
 *
 * Resolution streams the transcript page by page and folds the prefix hash as
 * it goes, so nothing before the boundary is retained and a transcript of any
 * length costs one page of memory. What comes back is bounded too: at most
 * `limit` entries after the boundary. A longer backlog is reviewed in
 * consecutive runs — each advances the journal by one window — rather than
 * being read whole (which OOM'd `cb serve` on 2026-08-01) or stalling forever
 * (which the bounded read that replaced it did).
 *
 * See docs/implemented-plans/chat-review.md § Track A.
 */

import { createHash, type Hash } from "node:crypto";
import { MAX_SESSION_ENTRIES } from "../../../cli/lib/session-retention.js";
import type { SessionEntry } from "../../../cli/lib/session.js";
import { contentHash } from "../../../lib/content-hash.js";
import { renderEntries } from "../transcript-render.js";
import type { AppliedSpan } from "./state.js";

/** Why a span is being read from the top rather than continuing a journal. */
export type BootstrapReason = "no-journal" | "boundary-missing" | "prefix-rewritten";

export interface ResolvedSpan {
  /**
   * Entries not yet folded into the account, at most `limit` of them. Empty
   * when nothing is new.
   */
  entries: SessionEntry[];
  /** Index of the last entry in `entries` within the full transcript, or -1 when empty. */
  endIndex: number;
  /**
   * The journal hash for a boundary at `endIndex`: sha256 over every entry of
   * the transcript through `endIndex`, not just over `entries`. Null when
   * `entries` is empty.
   */
  endPrefixHash: string | null;
  /**
   * Non-null when the journal could not be continued and the transcript is
   * being read from the top. The caller warns on
   * `boundary-missing`/`prefix-rewritten` — those mean the transcript was
   * rewritten under us.
   */
  bootstrap: BootstrapReason | null;
  /**
   * True when unread entries exist past `entries` — the window cap was hit.
   * The next run picks up from the new boundary.
   */
  clipped: boolean;
}

/**
 * The prefix hash, folded one entry at a time. Produces exactly
 * {@link prefixHash}'s digest for the same entries, so journals written before
 * streaming resolution still verify.
 */
class PrefixHasher {
  private readonly hash: Hash = createHash("sha256");
  private count = 0;

  update(entry: SessionEntry): void {
    if (this.count > 0) this.hash.update("\n");
    this.hash.update(`${entry.uuid}\u0000${renderEntries([entry])}`);
    this.count += 1;
  }

  digest(): string {
    return this.hash.copy().digest("hex").slice(0, 16);
  }
}

/**
 * sha256 over the uuid AND rendered content of every entry up to `endIndex`.
 *
 * Content matters, not just identity: the SDK can rewrite an entry's text while
 * keeping its uuid, and a uuid-only hash would call that history unchanged and
 * skip the rewritten material. Hashing what we actually read makes any edit
 * before the boundary a mismatch, which forces a re-read.
 *
 * Whole-array form; resolution folds the same bytes incrementally.
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

/** One bounded page of a transcript, positionally numbered from the top. */
export type SpanPageReader = (page: { offset: number; limit: number }) => Promise<{
  entries: SessionEntry[];
  /** Exact count of entries in the whole transcript. */
  total: number;
}>;

export interface ResolveSpanArgs {
  /** Reads one page of the transcript; called as many times as resolution needs. */
  readPage: SpanPageReader;
  /** The last span applied to this session; null when there is none. */
  applied: AppliedSpan | null;
  /**
   * Most entries a span may hold, and the page size of each read. Defaults to
   * the scan's hard ceiling.
   */
  limit?: number;
}

/**
 * Locate the unread span, reading the transcript in pages from the top.
 *
 * Bootstrap (the first `limit` entries) happens when there is no journal
 * entry, when the recorded boundary entry is gone, or when the history before
 * it no longer hashes the same. The last two mean a rewrite: the caller keeps
 * the existing account, which is now the only surviving record of what was
 * rewritten.
 */
export async function resolveSpan(args: ResolveSpanArgs): Promise<ResolvedSpan> {
  const { readPage, applied } = args;
  const limit = args.limit ?? MAX_SESSION_ENTRIES;

  // `parseSessionLog` defaults a missing uuid to "" (cli/lib/session-entry.ts),
  // so an empty boundary is not an identity at all — several entries could
  // match it. Treat it as unusable rather than resolving to the wrong one.
  if (applied === null) return bootstrap({ readPage, limit, reason: "no-journal" });
  if (applied.endUuid === "") return bootstrap({ readPage, limit, reason: "boundary-missing" });

  const hasher = new PrefixHasher();
  const retained: SessionEntry[] = [];
  let found = false;
  let offset = 0;
  let endIndex = -1;
  let clipped = false;
  for (;;) {
    const page = await readPage({ offset, limit });
    for (const [i, entry] of page.entries.entries()) {
      if (found) {
        if (retained.length >= limit) {
          clipped = true;
          break;
        }
        retained.push(entry);
        endIndex = offset + i;
      }
      hasher.update(entry);
      if (!found && entry.uuid === applied.endUuid) {
        if (hasher.digest() !== applied.prefixHash) {
          // The boundary IS here; only the history before it changed. That's a
          // genuine rewrite, and re-reading from the top is the right response.
          return bootstrap({ readPage, limit, reason: "prefix-rewritten" });
        }
        found = true;
      }
    }
    offset += page.entries.length;
    // A page can come back short of `limit` without ending the transcript (the
    // scan clips a page at its byte budget); only an empty page or reaching
    // `total` ends the walk.
    if (clipped || page.entries.length === 0 || offset >= page.total) break;
  }

  if (!found) return bootstrap({ readPage, limit, reason: "boundary-missing" });
  return {
    entries: retained,
    endIndex,
    endPrefixHash: retained.length > 0 ? hasher.digest() : null,
    bootstrap: null,
    clipped,
  };
}

async function bootstrap(args: {
  readPage: SpanPageReader;
  limit: number;
  reason: BootstrapReason;
}): Promise<ResolvedSpan> {
  const { readPage, limit, reason } = args;
  const page = await readPage({ offset: 0, limit });
  const hasher = new PrefixHasher();
  for (const entry of page.entries) hasher.update(entry);
  return {
    entries: page.entries,
    endIndex: page.entries.length - 1,
    endPrefixHash: page.entries.length > 0 ? hasher.digest() : null,
    bootstrap: reason,
    clipped: page.entries.length < page.total,
  };
}

/** A page reader over an in-memory transcript — for tests and callers that already hold the entries. */
export function pagesOf(entries: SessionEntry[]): SpanPageReader {
  return ({ offset, limit }) => Promise.resolve({
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
  });
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
  span: ResolvedSpan;
  now: Date;
}): AppliedSpan | null {
  const { sessionId, span, now } = args;
  const endEntry = span.entries.at(-1);
  // No boundary identity means no journal entry — the next run bootstraps,
  // which is correct-but-wasteful rather than silently wrong.
  if (endEntry === undefined || endEntry.uuid === "" || span.endPrefixHash === null) return null;
  return {
    spanId: computeSpanId({ sessionId, endUuid: endEntry.uuid, prefixHash: span.endPrefixHash }),
    endUuid: endEntry.uuid,
    endIndex: span.endIndex,
    prefixHash: span.endPrefixHash,
    at: now.toISOString(),
  };
}

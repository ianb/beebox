/**
 * Which chat sessions are worth reviewing tonight.
 *
 * Discovery is **husk-first**: chat review only ever writes husk cards, and a
 * session with no husk is out of scope, so `listChatHusks` already enumerates
 * exactly the in-scope corpus. That is why this needs none of retro's
 * chat-detection heuristics (`core/retro/discovery.ts` inspects
 * `<typed>`/`<speech>` tags to tell chats from job runs) — husk existence is
 * the answer.
 *
 * A session qualifies when its transcript exists, has been quiet past the
 * quiescence window, holds at least REVIEW_MIN_USER_TURNS real user turns, and
 * its unread span renders to at least REVIEW_CHAR_THRESHOLD characters.
 *
 * Qualifying a session requires parsing its transcript, but nothing parsed is
 * retained: a `QualifiedSession` is scalars only, and the reviewer re-reads the
 * sessions it actually reviews (see {@link QualifiedSession}).
 *
 * See docs/implemented-plans/chat-review.md § Track A.
 */

import * as fs from "node:fs/promises";
import {
  MAX_SESSION_ENTRIES,
  getSessionMetadata,
  parseSessionLog,
  type SessionEntry,
} from "../../../cli/lib/session.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { listChatHusks, type ChatHuskEntry } from "../husk.js";
import { huskTranscriptPath } from "../husk-transcript.js";
import { METADATA_CONSUMER, sessionState, type ReviewState } from "./state.js";
import { resolveSpan, spanSize, type BootstrapReason, type ResolvedSpan } from "./span.js";

/**
 * How long a transcript must sit unmodified before it is reviewed — don't
 * summarize a conversation that is still happening. Matches retro's window
 * (`core/retro/discovery.ts`), for the same reason.
 */
export const QUIESCENCE_MS = 30 * 60 * 1000;

/** Pre-elision rendered chars of new material required to trigger a review. */
export const REVIEW_CHAR_THRESHOLD = 6_000;

/** Real user turns in the whole session before it is reviewed at all. */
export const REVIEW_MIN_USER_TURNS = 2;

/**
 * Chat review reads a transcript from the top: `resolveSpan` hashes every
 * entry before the journal boundary, so the read has to be a first-page read,
 * not a tail. It is nonetheless bounded — retaining a whole transcript is what
 * OOM'd `cb serve` (see `cli/lib/session-retention.ts`) — and a session past
 * the cap is reported loudly rather than silently truncated.
 */
const PARSE_LIMIT = MAX_SESSION_ENTRIES;

/**
 * A session that passed the gates — deliberately **scalars only**.
 *
 * Discovery holds every qualified session simultaneously, and `runChatReview`
 * caps the run only afterwards, so retaining each one's parsed transcript here
 * meant N × MAX_SESSION_ENTRIES fat entries (whole `tool_use.input` bodies,
 * base64 images) resident at once — the same allocation class that OOM'd
 * `cb serve`. The transcript is parsed to qualify the session and then dropped;
 * the reviewer re-reads the one session it is about to review
 * ({@link readSessionWindow}), so at most one window is alive at a time.
 */
export interface QualifiedSession {
  sessionId: string;
  /** Box-relative husk card path. */
  huskPath: string;
  logPath: string;
  mtime: Date;
  /** Pre-elision rendered length of the span, measured during the scan. */
  spanChars: number;
  /** Why the span was read from the top, or null when it continues the journal. */
  bootstrap: BootstrapReason | null;
  /**
   * The title `ensureChatHusk` would derive from this transcript. Lets the
   * reviewer tell an untouched auto-title from one a person typed.
   */
  snippetTitle: string | null;
}

export interface DiscoveryResult {
  /** Ready to review, oldest first (stable processing order). */
  qualified: QualifiedSession[];
  /** Skipped: transcript changed within the quiescence window. */
  deferredActive: string[];
  /** Skipped: not enough new material since the last applied span. */
  belowThreshold: number;
  /** Skipped: fewer than REVIEW_MIN_USER_TURNS real user turns. */
  tooFewTurns: number;
  /** Husks whose transcript is gone — nothing to read, husk left alone. */
  missingTranscripts: number;
  /** Skipped: the journal boundary lies past the bounded read window. */
  boundaryBeyondWindow: number;
}

export interface DiscoverOptions {
  now: Date;
  quiescenceMs: number;
  state: ReviewState;
}

function emptyResult(): DiscoveryResult {
  return {
    qualified: [],
    deferredActive: [],
    belowThreshold: 0,
    tooFewTurns: 0,
    missingTranscripts: 0,
    boundaryBeyondWindow: 0,
  };
}

/** A bounded first-page read, plus whether the transcript ran past it. */
interface ParsedWindow {
  entries: SessionEntry[];
  /** True when the transcript holds more entries than `entries` — read capped. */
  truncated: boolean;
}

/**
 * Parse a transcript's bounded first page. Returns null when the file is gone
 * (the SDK cleaned it up, or `~/.claude` was cleared between listing and
 * reading).
 */
async function parseFull(logPath: string): Promise<ParsedWindow | null> {
  try {
    const { entries, total } = await parseSessionLog({
      logPath,
      slice: { mode: "page", offset: 0, limit: PARSE_LIMIT },
    });
    const truncated = entries.length < total;
    if (truncated) {
      // Degraded, but visibly: the span this session resolves is computed over
      // the first PARSE_LIMIT entries, so review stops advancing once a
      // transcript grows past the cap. Reviewing a transcript that long needs
      // a streaming span resolver — see
      // issues/bugs/2026-08-01-chat-review-capped-at-max-session-entries.md.
      console.warn(
        `chat-review: transcript ${logPath} has ${String(total)} entries; reviewing only the first ${String(entries.length)} (bounded read).`,
      );
    }
    return { entries, truncated };
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** One session's parsed transcript window plus the unread span within it. */
export interface SessionWindow {
  /** The bounded first-page read of the transcript. */
  entries: SessionEntry[];
  span: ResolvedSpan;
}

/**
 * Read the bounded window for one session and locate its unread span.
 *
 * Both discovery (to measure the span) and the reviewer (to render it) go
 * through this. The reviewer re-reads rather than being handed discovery's
 * array on purpose: see {@link QualifiedSession}. Returns null when the
 * transcript is gone.
 *
 * Every read reports the entry cap, including the reviewer's. A transcript that
 * crosses PARSE_LIMIT between the two reads is truncated in the read that
 * actually advances the journal, so silencing the second one would hide exactly
 * the case that matters; two lines about one over-long session is the cheaper
 * cost.
 */
export async function readSessionWindow(args: {
  sessionId: string;
  logPath: string;
  state: ReviewState;
}): Promise<SessionWindow | null> {
  const parsed = await parseFull(args.logPath);
  if (parsed === null) return null;
  const { entries, truncated } = parsed;
  const applied = sessionState(args.state, args.sessionId).applied[METADATA_CONSUMER] ?? null;
  return { entries, span: resolveSpan({ entries, applied, truncated }) };
}

/**
 * The shared reaction to an unresolvable span: say which session, and why it is
 * being left alone. Both readers of a window (discovery's measurement and the
 * reviewer's re-read) can hit it — the second only when a transcript crosses
 * the cap between the two reads — so the message lives here once.
 */
export function warnDeferredBoundary(sessionId: string): void {
  console.warn(
    `chat-review: session ${sessionId} has a journal boundary that is not in the first `
      + `${String(PARSE_LIMIT)} entries of its transcript, and the transcript is longer than that — `
      + "the boundary is past the read window. Skipping it rather than re-reading from the top, "
      + "which would re-summarize old material and move the journal backwards. "
      + "See issues/bugs/2026-08-01-chat-review-capped-at-max-session-entries.md.",
  );
}

async function qualifyHusk(
  husk: ChatHuskEntry,
  args: { boxRoot: string; options: DiscoverOptions; result: DiscoveryResult },
): Promise<QualifiedSession | null> {
  const { boxRoot, options, result } = args;
  const logPath = huskTranscriptPath(boxRoot, husk);

  let mtime: Date;
  try {
    mtime = (await fs.stat(logPath)).mtime;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    result.missingTranscripts += 1;
    return null;
  }

  if (options.now.getTime() - mtime.getTime() < options.quiescenceMs) {
    result.deferredActive.push(husk.session);
    return null;
  }

  const meta = await getSessionMetadata({ sessionId: husk.session, logPath, snippetMaxLen: 80 });
  if (meta.userTurns < REVIEW_MIN_USER_TURNS) {
    result.tooFewTurns += 1;
    return null;
  }

  // Scoped to this block so the window is unreachable the moment the scalars
  // below have been taken from it — the array must not outlive qualification.
  const window = await readSessionWindow({ sessionId: husk.session, logPath, state: options.state });
  if (window === null) {
    result.missingTranscripts += 1;
    return null;
  }
  if (window.span.deferred !== null) {
    // Unresolvable span: not "nothing new", so it must NOT fall through to the
    // threshold bucket, which would report it as quietly uninteresting.
    warnDeferredBoundary(husk.session);
    result.boundaryBeyondWindow += 1;
    return null;
  }
  const spanChars = spanSize(window.span);
  const bootstrap = window.span.bootstrap;
  if (spanChars < REVIEW_CHAR_THRESHOLD) {
    result.belowThreshold += 1;
    return null;
  }

  return {
    sessionId: husk.session,
    huskPath: husk.path,
    logPath,
    mtime,
    spanChars,
    bootstrap,
    snippetTitle: meta.firstUserSnippet?.trim() || null,
  };
}

export async function discoverSessions(
  boxRoot: string,
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const husks = await listChatHusks(boxRoot);
  const result = emptyResult();

  for (const husk of husks) {
    // Exhaustion is NOT checked here: it is scoped to a particular span, and
    // the span isn't known until the transcript is parsed. runChatReview makes
    // that call, so growth always gets a fresh attempt.
    const qualified = await qualifyHusk(husk, { boxRoot, options, result });
    if (qualified !== null) result.qualified.push(qualified);
  }

  // Oldest first, so a capped run makes progress on the longest-neglected
  // sessions rather than re-visiting the freshest every night.
  result.qualified.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  return result;
}

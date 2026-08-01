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
import { resolveSpan, spanSize, type ResolvedSpan } from "./span.js";

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

export interface QualifiedSession {
  sessionId: string;
  /** Box-relative husk card path. */
  huskPath: string;
  logPath: string;
  mtime: Date;
  /** Full parsed transcript, reused by the reviewer so it parses once per run. */
  entries: SessionEntry[];
  span: ResolvedSpan;
  /** Pre-elision rendered length of the span. */
  spanChars: number;
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
  };
}

/**
 * Parse a transcript in full. Returns null when the file is gone (the SDK
 * cleaned it up, or `~/.claude` was cleared between listing and reading).
 */
async function parseFull(logPath: string): Promise<SessionEntry[] | null> {
  try {
    const { entries, total } = await parseSessionLog({
      logPath,
      slice: { mode: "page", offset: 0, limit: PARSE_LIMIT },
    });
    if (entries.length < total) {
      // Degraded, but visibly: the span this session resolves is computed over
      // the first PARSE_LIMIT entries, so review stops advancing once a
      // transcript grows past the cap. Reviewing a transcript that long needs
      // a streaming span resolver — see
      // issues/bugs/2026-08-01-chat-review-capped-at-max-session-entries.md.
      console.warn(
        `chat-review: transcript ${logPath} has ${String(total)} entries; reviewing only the first ${String(entries.length)} (bounded read).`,
      );
    }
    return entries;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
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

  const entries = await parseFull(logPath);
  if (entries === null) {
    result.missingTranscripts += 1;
    return null;
  }

  const applied = sessionState(options.state, husk.session).applied[METADATA_CONSUMER] ?? null;
  const span = resolveSpan(entries, applied);
  const spanChars = spanSize(span);
  if (spanChars < REVIEW_CHAR_THRESHOLD) {
    result.belowThreshold += 1;
    return null;
  }

  return {
    sessionId: husk.session,
    huskPath: husk.path,
    logPath,
    mtime,
    entries,
    span,
    spanChars,
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

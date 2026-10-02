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
 * A session qualifies when this machine originated it, its transcript exists,
 * it has been quiet past the quiescence window, it holds at least
 * REVIEW_MIN_USER_TURNS real user turns, and its unread span renders to at
 * least REVIEW_CHAR_THRESHOLD characters.
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
} from "../../../cli/lib/session.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { listChatHusks, type ChatHuskEntry } from "../husk-read.js";
import { localOrigin } from "../session/origin.js";
import { huskTranscriptPath } from "../husk-transcript.js";
import { METADATA_CONSUMER, TITLE_CONSUMER, sessionState, type ReviewState } from "./state.js";
import { resolveSpan, spanSize, type BootstrapReason, type ResolvedSpan, type SpanPageReader } from "./span.js";
import { resolveChatEngine } from "../session/engine.js";
import { loadSessionHistory } from "../session/load-history.js";
import { readCodexSessionUpdatedAt } from "../session/codex-transcript.js";
import type { AgentEngine } from "../../box/config.js";
import { stripChatAppTags } from "../../../shared/chat-tags.js";

/**
 * How long a transcript must sit unmodified before it is reviewed — don't
 * summarize a conversation that is still happening. Matches retro's window
 * (`core/retro/discovery.ts`), for the same reason.
 */
export const QUIESCENCE_MS = 30 * 60 * 1000;

/** Pre-elision rendered chars of new material required to trigger a review. */
export const REVIEW_CHAR_THRESHOLD = 6_000;

/**
 * Pre-elision rendered chars of new material required to trigger a **title**
 * pass. Deliberately tiny: with two user turns already required, 400 chars
 * means "a real exchange happened", the same job the 6,000-char gate does for
 * summaries — keeping a nightly model call off trivial growth. As untuned as
 * the summary threshold (`docs/plans/chat-titles.md` § Track A).
 */
export const TITLE_CHAR_THRESHOLD = 400;

/** Real user turns in the whole session before it is reviewed at all. */
const REVIEW_MIN_USER_TURNS = 2;

/**
 * Page size for the span walk, and the most entries one review may fold in.
 * `resolveSpan` reads a transcript from the top in pages of this size,
 * retaining nothing before the journal boundary and at most this many entries
 * after it; a longer backlog is reviewed across consecutive runs.
 */
const PARSE_LIMIT = MAX_SESSION_ENTRIES;

/**
 * A session that passed the gates — deliberately **scalars only**.
 *
 * Discovery holds every qualified session simultaneously, and `runChatReview`
 * caps the run only afterwards, so retaining each one's parsed transcript here
 * meant N × MAX_SESSION_ENTRIES fat entries (whole `tool_use.input` bodies,
 * base64 images) resident at once — the same allocation class that OOM'd
 * `bbx serve`. The transcript is parsed to qualify the session and then dropped;
 * the reviewer re-reads the one session it is about to review
 * ({@link readSessionWindow}), so at most one window is alive at a time.
 */
export interface QualifiedSession {
  sessionId: string;
  /** Box-relative husk card path. */
  huskPath: string;
  logPath: string;
  /** Native harness that owns the transcript. Missing means legacy Claude. */
  engine?: AgentEngine;
  mtime: Date;
  /** Pre-elision rendered length of the metadata span, measured during the scan. */
  spanChars: number;
  /** Why the metadata span was read from the top, or null when it continues the journal. */
  bootstrap: BootstrapReason | null;
  /**
   * False when the metadata span is below REVIEW_CHAR_THRESHOLD — the session
   * qualifies for the title pass only. Summary-sized growth flips it, and the
   * metadata pass then advances both journals.
   */
  needsMetadata: boolean;
  /** Pre-elision rendered length of the title span (the cheaper gate's measure). */
  titleSpanChars: number;
  /** Why the title span was read from the top, or null when it continues the journal. */
  titleBootstrap: BootstrapReason | null;
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
  /**
   * Skipped: not enough new material for even a title pass since the last
   * applied span. Sessions between this and the summary gate are *qualified*
   * (title-only) and counted in {@link titleOnly}, not skipped.
   */
  belowTitleThreshold: number;
  /** Qualified sessions whose growth clears the title gate but not the summary gate. */
  titleOnly: number;
  /**
   * Qualified sessions that failed the summary gate — a subset of
   * `qualified` (the title-only ones above). Reported so `status` keeps
   * answering "how many are worth a full review".
   */
  belowThreshold: number;
  /** Skipped: fewer than REVIEW_MIN_USER_TURNS real user turns. */
  tooFewTurns: number;
  /** Husks whose transcript is gone — nothing to read, husk left alone. */
  missingTranscripts: number;
  /**
   * Skipped: the session ran on another machine, which is the only one that
   * can see the whole conversation. Counted, never named — see
   * {@link claimsSession}.
   */
  foreignOrigin: number;
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
    belowTitleThreshold: 0,
    titleOnly: 0,
    belowThreshold: 0,
    tooFewTurns: 0,
    missingTranscripts: 0,
    foreignOrigin: 0,
  };
}

/**
 * Whether this machine may review a session.
 *
 * Two checkouts share one account but hold different transcript subsets, so a
 * machine that reviews a session it did not originate extends
 * `contains-evidence` from partial material — the origin machine is the only
 * one that can see the whole conversation
 * (`docs/implemented-plans/chat-session-identity.md`, Track 4).
 *
 * A husk with no `origin` predates the Track 2 stamp; it is claimed when its
 * transcript is here, which is the same evidence the backfill uses. Reconcile
 * stamps such husks on the next boot, so this branch decays to nothing.
 */
function claimsSession(husk: ChatHuskEntry, localOriginId: string): boolean {
  return husk.origin === undefined || husk.origin === localOriginId;
}

/**
 * A page reader over a Claude transcript. Returns null pages when the file is
 * gone (the SDK cleaned it up, or `~/.claude` was cleared between listing and
 * reading) — surfaced as a null window by {@link readSessionWindow}.
 */
function claudePages(logPath: string): SpanPageReader {
  return ({ offset, limit }) => parseSessionLog({ logPath, slice: { mode: "page", offset, limit } });
}

function codexPages(boxRoot: string, sessionId: string): SpanPageReader {
  return ({ offset, limit }) => loadSessionHistory(boxRoot, {
    sessionId,
    slice: { mode: "page", offset, limit },
  });
}

/**
 * Locate one session's unread span for one journal consumer. Both discovery
 * (to measure the span) and the reviewer (to render it) go through this; the
 * consumer names which journal the span continues — `metadata` or `title`.
 * The reviewer re-reads rather than being handed discovery's array on
 * purpose: see {@link QualifiedSession}.
 * Returns null when the transcript is gone.
 */
export async function readSessionWindow(args: {
  sessionId: string;
  logPath: string;
  state: ReviewState;
  consumer: string;
  boxRoot?: string;
}): Promise<ResolvedSpan | null> {
  const readPage = args.boxRoot === undefined
    ? claudePages(args.logPath)
    : codexPages(args.boxRoot, args.sessionId);
  const applied = sessionState(args.state, args.sessionId).applied[args.consumer] ?? null;
  try {
    const span = await resolveSpan({ readPage, applied, limit: PARSE_LIMIT });
    if (span.clipped) {
      console.warn(
        `chat-review: session ${args.sessionId} has more than ${String(PARSE_LIMIT)} unread entries; `
          + "reviewing the first window now and the rest on later runs.",
      );
    }
    return span;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

async function qualifyHusk(
  husk: ChatHuskEntry,
  args: { boxRoot: string; options: DiscoverOptions; result: DiscoveryResult; localOriginId: string },
): Promise<QualifiedSession | null> {
  const { boxRoot, options, result } = args;
  if (!claimsSession(husk, args.localOriginId)) {
    result.foreignOrigin += 1;
    return null;
  }
  const logPath = huskTranscriptPath(boxRoot, husk);
  const engine = await resolveChatEngine(boxRoot, { sessionId: husk.session, husk });

  let mtime: Date;
  try {
    mtime = engine === "codex"
      ? await readCodexSessionUpdatedAt(boxRoot, husk.session)
      : (await fs.stat(logPath)).mtime;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    result.missingTranscripts += 1;
    return null;
  }

  if (options.now.getTime() - mtime.getTime() < options.quiescenceMs) {
    result.deferredActive.push(husk.session);
    return null;
  }

  const codexHistory = engine === "codex"
    ? await loadSessionHistory(boxRoot, {
      sessionId: husk.session,
      slice: { mode: "page", offset: 0, limit: PARSE_LIMIT },
    })
    : null;
  const meta = codexHistory === null
    ? await getSessionMetadata({ sessionId: husk.session, logPath, snippetMaxLen: 80 })
    : {
      userTurns: codexHistory.entries.filter((entry) => entry.type === "user").length,
      // Strip the `<chat-app …/>` prepend before slicing, as the Claude path
      // does via `getSessionMetadata`'s snippet extraction.
      firstUserSnippet: stripChatAppTags(codexHistory.entries.find((entry) => entry.type === "user")?.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n") ?? "").trim().slice(0, 80),
    };
  if (meta.userTurns < REVIEW_MIN_USER_TURNS) {
    result.tooFewTurns += 1;
    return null;
  }

  // Scoped to this block so the windows are unreachable the moment the scalars
  // below have been taken from them — the arrays must not outlive
  // qualification. Two windows are resolved — the summary journal's and the
  // title journal's — but they share one read whenever the two boundaries
  // coincide, which is every session the metadata pass has already advanced
  // (it advances both).
  const windowArgs = {
    sessionId: husk.session,
    logPath,
    state: options.state,
    ...(engine === "codex" ? { boxRoot } : {}),
  } as const;
  const appliedFor = (consumer: string) =>
    sessionState(options.state, husk.session).applied[consumer] ?? null;
  const span = await readSessionWindow({ ...windowArgs, consumer: METADATA_CONSUMER });
  if (span === null) {
    result.missingTranscripts += 1;
    return null;
  }
  const titleSpan = appliedFor(TITLE_CONSUMER)?.endUuid === appliedFor(METADATA_CONSUMER)?.endUuid
    ? span
    : await readSessionWindow({ ...windowArgs, consumer: TITLE_CONSUMER });
  if (titleSpan === null) {
    result.missingTranscripts += 1;
    return null;
  }
  const titleSpanChars = spanSize(titleSpan);
  if (titleSpanChars < TITLE_CHAR_THRESHOLD) {
    result.belowTitleThreshold += 1;
    return null;
  }
  const spanChars = spanSize(span);
  const needsMetadata = spanChars >= REVIEW_CHAR_THRESHOLD;

  return {
    sessionId: husk.session,
    huskPath: husk.path,
    logPath,
    ...(engine === "codex" ? { engine } : {}),
    mtime,
    spanChars,
    bootstrap: span.bootstrap,
    needsMetadata,
    titleSpanChars,
    titleBootstrap: titleSpan.bootstrap,
    snippetTitle: meta.firstUserSnippet?.trim() || null,
  };
}

export async function discoverSessions(
  boxRoot: string,
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const husks = await listChatHusks(boxRoot);
  const result = emptyResult();
  // Once per run, not per husk: the id is a file read, and it cannot change
  // under a run.
  const { id: localOriginId } = await localOrigin();

  for (const husk of husks) {
    // Exhaustion is NOT checked here: it is scoped to a particular span, and
    // the span isn't known until the transcript is parsed. runChatReview makes
    // that call, so growth always gets a fresh attempt.
    const qualified = await qualifyHusk(husk, { boxRoot, options, result, localOriginId });
    if (qualified !== null) result.qualified.push(qualified);
  }

  // Oldest first, so a capped run makes progress on the longest-neglected
  // sessions rather than re-visiting the freshest every night.
  result.qualified.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  // Post-counts, not per-husk flags: each is a fact about the qualified set.
  result.titleOnly = result.qualified.filter((q) => !q.needsMetadata).length;
  result.belowThreshold = result.titleOnly;
  return result;
}

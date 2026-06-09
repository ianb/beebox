/**
 * Session discovery and qualification for the retrospective walker.
 *
 * A session qualifies for observation when it (1) is a chat session —
 * it has real `<typed>`/`<speech>` user messages (webapp chat tags its
 * input) or appears in a chat registry (telegram sends raw text, so the
 * registry is the marker there) — with at least one user message,
 * (2) has been quiet past the quiescence window (don't observe a
 * conversation in progress), and (3) isn't already settled in walker
 * state. See `docs/implemented-plans/box-retrospectives.md`.
 */

import {
  isRealUserMessage,
  listSessions,
  parseSessionLog,
} from "../../cli/lib/session.js";
import { loadChatRegistryIndex } from "./registries.js";
import { isSessionSettled, type RetroState } from "./state.js";

/** How long a transcript must sit unmodified before it can be observed. */
export const QUIESCENCE_MS = 30 * 60 * 1000;

export interface QualifiedSession {
  sessionId: string;
  logPath: string;
  mtime: Date;
  /** Human messages: typed/speech-tagged where tagged, else user entries. */
  userMessages: number;
  /** Thread card ref when a chat registry knows this session, else null. */
  threadRef: string | null;
}

export interface DiscoveryResult {
  /** Sessions ready to observe, oldest first (stable processing order). */
  qualified: QualifiedSession[];
  /** Sessions skipped because the transcript changed within the quiescence window. */
  deferredActive: string[];
  /** Sessions already settled in walker state (done, or permanently failed). */
  alreadyProcessed: number;
  /** Sessions that aren't chat (wakeup/job/procedure runs, or empty chats). */
  nonChat: number;
  /** Transcripts that vanished between listing and reading. */
  missingTranscripts: number;
  /** Chat registry files found (box-relative), for the run report. */
  registriesFound: string[];
}

export interface DiscoverOptions {
  now: Date;
  quiescenceMs: number;
  state: RetroState;
}

interface TranscriptCounts {
  /** All non-plumbing user entries. */
  userEntries: number;
  /** The subset carrying <typed>/<speech> tags. */
  tagged: number;
}

/**
 * Count user messages in a transcript, or null when the file is gone
 * (user cleared `~/.claude` between listing and reading).
 */
async function countUserMessages(logPath: string): Promise<TranscriptCounts | null> {
  try {
    const { entries } = await parseSessionLog({ logPath });
    const userEntries = entries.filter((entry) => entry.type === "user");
    return {
      userEntries: userEntries.length,
      tagged: userEntries.filter(isRealUserMessage).length,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function discoverSessions(
  boxRoot: string,
  options: DiscoverOptions
): Promise<DiscoveryResult> {
  const { now, quiescenceMs, state } = options;
  const registry = await loadChatRegistryIndex(boxRoot);
  const sessions = await listSessions(boxRoot);

  const result: DiscoveryResult = {
    qualified: [],
    deferredActive: [],
    alreadyProcessed: 0,
    nonChat: 0,
    missingTranscripts: 0,
    registriesFound: registry.registriesFound,
  };

  for (const session of sessions) {
    if (isSessionSettled(state, session.sessionId)) {
      result.alreadyProcessed += 1;
      continue;
    }
    if (now.getTime() - session.mtime.getTime() < quiescenceMs) {
      result.deferredActive.push(session.sessionId);
      continue;
    }
    const counts = await countUserMessages(session.path);
    if (counts === null) {
      result.missingTranscripts += 1;
      continue;
    }
    const inRegistry = registry.ids.has(session.sessionId);
    const userMessages = counts.tagged > 0 ? counts.tagged : counts.userEntries;
    if ((counts.tagged === 0 && !inRegistry) || userMessages === 0) {
      result.nonChat += 1;
      continue;
    }
    result.qualified.push({
      sessionId: session.sessionId,
      logPath: session.path,
      mtime: session.mtime,
      userMessages,
      threadRef: registry.threadRefs.get(session.sessionId) ?? null,
    });
  }

  // listSessions returns newest first; observe oldest first so recurrence
  // builds chronologically.
  result.qualified.reverse();
  return result;
}

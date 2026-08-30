/**
 * The retrospective scan — orchestrates one run: discover qualifying
 * chat sessions, render and observe each, dedupe against the ledger,
 * persist walker state, and write the per-run report.
 *
 * Integration (turning ledgered observations into card edits) is a
 * separate procedure step; the scan only looks and records.
 */

import {
  discoverSessions,
  QUIESCENCE_MS,
  type QualifiedSession,
} from "./discovery.js";
import { appendLedgerEntries, loadEvidenceHashes, type LedgerEntry } from "./ledger.js";
import { evidenceHash } from "./observations.js";
import type { RetroObserver } from "./observer.js";
import { renderSessionCompact } from "../chat/transcript-render.js";
import { writeRunReport, type RetroRunReportData } from "./report.js";
import { loadRetroState, saveRetroState, type RetroState } from "./state.js";

export interface ScanOptions {
  observer: RetroObserver;
  maxSessions: number;
  now: Date;
}

export interface ScanSummary {
  runId: string;
  /** Sessions whose observer pass completed. */
  observed: number;
  /** New observations ledgered this run. */
  observations: number;
  duplicatesSkipped: number;
  observerFailures: number;
  /** Box-relative report path, or null when nothing qualified. */
  reportPath: string | null;
}

/** Timestamp slug used for run ids and report filenames (matches `bbx feedback`). */
function makeRunId(now: Date): string {
  return now.toISOString().replace(/[.:]/g, "-").slice(0, 19);
}

interface ObservePassResult {
  entries: LedgerEntry[];
  duplicatesSkipped: number;
  failed: boolean;
}

async function observeSession(
  session: QualifiedSession,
  args: {
    observer: RetroObserver;
    runId: string;
    now: Date;
    seenHashes: Set<string>;
  }
): Promise<ObservePassResult> {
  const { observer, runId, now, seenHashes } = args;

  let transcript: string;
  try {
    transcript = await renderSessionCompact(session.logPath);
  } catch (e) {
    console.warn(`retro: could not render session ${session.sessionId}, skipping:`, e);
    return { entries: [], duplicatesSkipped: 0, failed: true };
  }

  let observations;
  try {
    observations = await observer.observe({ sessionId: session.sessionId, transcript });
  } catch (e) {
    console.warn(`retro: observer failed for session ${session.sessionId}:`, e);
    return { entries: [], duplicatesSkipped: 0, failed: true };
  }

  const entries: LedgerEntry[] = [];
  let duplicatesSkipped = 0;
  for (const observation of observations) {
    const hash = evidenceHash(observation.evidence);
    if (seenHashes.has(hash)) {
      duplicatesSkipped += 1;
      continue;
    }
    seenHashes.add(hash);
    entries.push({
      ...observation,
      runId,
      sessionId: session.sessionId,
      threadRef: session.threadRef,
      evidenceHash: hash,
      observedAt: now.toISOString(),
    });
  }
  return { entries, duplicatesSkipped, failed: false };
}

function recordSessionState(
  state: RetroState,
  args: { sessionId: string; failed: boolean; now: Date }
): void {
  const { sessionId, failed, now } = args;
  if (failed) {
    const previous = state.sessions[sessionId];
    state.sessions[sessionId] = {
      status: "failed",
      attempts: (previous ? previous.attempts : 0) + 1,
      at: now.toISOString(),
    };
  } else {
    state.sessions[sessionId] = { status: "done", attempts: 1, at: now.toISOString() };
  }
}

export async function runRetroScan(
  boxRoot: string,
  options: ScanOptions
): Promise<ScanSummary> {
  const { observer, maxSessions, now } = options;
  const runId = makeRunId(now);

  const state = await loadRetroState(boxRoot);
  const discovery = await discoverSessions(boxRoot, {
    now,
    quiescenceMs: QUIESCENCE_MS,
    state,
  });
  const planned = discovery.qualified.slice(0, maxSessions);
  const overflow = discovery.qualified.length - planned.length;

  if (planned.length === 0) {
    state.lastRunAt = now.toISOString();
    await saveRetroState(boxRoot, state);
    return {
      runId,
      observed: 0,
      observations: 0,
      duplicatesSkipped: 0,
      observerFailures: 0,
      reportPath: null,
    };
  }

  const seenHashes = await loadEvidenceHashes(boxRoot);
  const recorded: LedgerEntry[] = [];
  const examined: RetroRunReportData["examined"] = [];
  let duplicatesSkipped = 0;
  let observerFailures = 0;
  let observed = 0;

  for (const session of planned) {
    const result = await observeSession(session, { observer, runId, now, seenHashes });
    recordSessionState(state, { sessionId: session.sessionId, failed: result.failed, now });
    if (result.failed) {
      observerFailures += 1;
      continue;
    }
    observed += 1;
    duplicatesSkipped += result.duplicatesSkipped;
    recorded.push(...result.entries);
    examined.push({
      sessionId: session.sessionId,
      threadRef: session.threadRef,
      userMessages: session.userMessages,
      mtime: session.mtime.toISOString(),
    });
  }

  await appendLedgerEntries(boxRoot, recorded);
  state.lastRunAt = now.toISOString();
  await saveRetroState(boxRoot, state);

  const reportPath = await writeRunReport(boxRoot, {
    runId,
    generatedAt: now.toISOString(),
    examined,
    deferredActive: discovery.deferredActive,
    alreadyProcessed: discovery.alreadyProcessed,
    nonChat: discovery.nonChat,
    missingTranscripts: discovery.missingTranscripts,
    overflow,
    registriesFound: discovery.registriesFound,
    observations: recorded,
    duplicatesSkipped,
    observerFailures,
  });

  return {
    runId,
    observed,
    observations: recorded.length,
    duplicatesSkipped,
    observerFailures,
    reportPath,
  };
}

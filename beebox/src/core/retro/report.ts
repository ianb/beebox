/**
 * Per-run retrospective report — the boxholder's review surface.
 *
 * Each `bbx retro scan` writes `_content/reviews/retro/<runId>.md` recording
 * exactly what was looked at, what was noticed, and (once the integrator
 * has run) what was done about it. Plain markdown rather than a card: a
 * machine-written audit artifact, browsable via the file renderer, with
 * no agent-facing schema to maintain.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LedgerEntry } from "./ledger.js";
import { BOX_DIRS } from "../../lib/paths.js";

const RETRO_REPORTS_DIR = BOX_DIRS.retroReports;

export interface RetroRunSessionSummary {
  sessionId: string;
  threadRef: string | null;
  userMessages: number;
  /** Transcript last-modified, ISO. */
  mtime: string;
}

export interface RetroRunReportData {
  runId: string;
  generatedAt: string;
  examined: RetroRunSessionSummary[];
  deferredActive: string[];
  alreadyProcessed: number;
  nonChat: number;
  missingTranscripts: number;
  /** Qualified sessions left for the next run by the per-run cap. */
  overflow: number;
  registriesFound: string[];
  /** Observations recorded this run (already deduped and ledgered). */
  observations: LedgerEntry[];
  /** Observations dropped as exact duplicates of ledgered evidence. */
  duplicatesSkipped: number;
  /** Sessions whose observer pass failed (retried on a later run). */
  observerFailures: number;
}

/** Box-relative path of a run's report file. */
function runReportPath(runId: string): string {
  return `${RETRO_REPORTS_DIR}/${runId}.md`;
}

function renderExamined(data: RetroRunReportData): string[] {
  if (data.examined.length === 0) {
    return ["No sessions qualified for observation this run."];
  }
  const lines = data.examined.map((session) => {
    const thread = session.threadRef ? ` — ${session.threadRef}` : "";
    const plural = session.userMessages === 1 ? "" : "s";
    return `- \`${session.sessionId}\` (${session.mtime}, ${session.userMessages} user message${plural})${thread}`;
  });
  return lines;
}

function renderSkips(data: RetroRunReportData): string[] {
  const skips: string[] = [];
  if (data.alreadyProcessed > 0) skips.push(`${data.alreadyProcessed} already processed`);
  if (data.nonChat > 0) skips.push(`${data.nonChat} non-chat (wakeup/job/procedure runs)`);
  if (data.deferredActive.length > 0) {
    skips.push(`${data.deferredActive.length} deferred (active within the quiescence window)`);
  }
  if (data.missingTranscripts > 0) {
    skips.push(`${data.missingTranscripts} transcripts missing (cleared from ~/.claude)`);
  }
  if (data.overflow > 0) skips.push(`${data.overflow} beyond the per-run cap (next run picks them up)`);
  if (data.observerFailures > 0) {
    skips.push(`${data.observerFailures} observer failures (retried next run)`);
  }
  if (skips.length === 0) return [];
  return ["", `Skipped: ${skips.join("; ")}.`];
}

function renderObservations(data: RetroRunReportData): string[] {
  const lines: string[] = [];
  if (data.observations.length === 0) {
    lines.push("_None recorded._");
  } else {
    for (const obs of data.observations) {
      const sink = obs.sinkRef ? `${obs.sink}: ${obs.sinkRef}` : obs.sink;
      lines.push(`- **${obs.kind}** (\`${obs.sessionId}\`, → ${sink}): ${obs.proposal}`);
      for (const quoteLine of obs.evidence.split("\n")) {
        lines.push(`  > ${quoteLine}`);
      }
    }
  }
  if (data.duplicatesSkipped > 0) {
    const plural = data.duplicatesSkipped === 1 ? "" : "s";
    lines.push("", `${data.duplicatesSkipped} duplicate observation${plural} skipped (evidence already in the ledger).`);
  }
  return lines;
}

/**
 * Render the report skeleton. The "What I learned", "Observations", and
 * "Actions taken" sections are filled in by later pipeline stages (the
 * observer appends observations; the integrator writes the narrative and
 * actions).
 */
export function renderRunReport(data: RetroRunReportData): string {
  const registries =
    data.registriesFound.length > 0
      ? `Chat registries: ${data.registriesFound.map((r) => `\`${r}\``).join(", ")}.`
      : "No chat registries found — thread provenance unavailable for this box.";

  // With no observations there is nothing for the integrator to do — the
  // report finalizes itself rather than dangling a "pending" marker.
  const hasObservations = data.observations.length > 0;
  const lines: string[] = [
    `# Retrospective run ${data.runId}`,
    "",
    `Generated ${data.generatedAt}.`,
    "",
    "## What I learned",
    "",
    hasObservations ? "_Pending integration._" : "_Nothing new this run._",
    "",
    "## Sessions examined",
    "",
    ...renderExamined(data),
    ...renderSkips(data),
    "",
    registries,
    "",
    "## Observations",
    "",
    ...renderObservations(data),
    "",
    "## Actions taken",
    "",
    hasObservations ? "_Pending integration._" : "_None — no observations to integrate._",
    "",
  ];
  return lines.join("\n");
}

/** Write a run report into the box; returns its box-relative path. */
export async function writeRunReport(
  boxRoot: string,
  data: RetroRunReportData
): Promise<string> {
  const relPath = runReportPath(data.runId);
  const absPath = path.join(boxRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, renderRunReport(data), "utf-8");
  return relPath;
}

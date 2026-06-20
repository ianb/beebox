/**
 * Context-size history — a committed, append-only ledger of audit baselines
 * over time, so trimming a box's always-on context shows up as a measurable
 * trend rather than a number you eyeball across two ephemeral reports.
 *
 * Stored as YAML keyed by box basename → audit id → entries (oldest first).
 * Each entry stamps the date and both git commits that determine the size: the
 * box's own HEAD (its CLAUDE.md and box-side docs) and the monorepo HEAD (the
 * system prompt, agent-guide generator, and tool schemas). Uncommitted edits
 * to either don't move the hash — commit the trim, then re-run.
 */

import * as fs from "node:fs/promises";
import YAML from "yaml";
import type { ContextStats } from "./context-usage.js";

export interface ContextHistoryEntry {
  date: string;
  boxCommit: string;
  repoCommit: string;
  initial: number;
  peak: number;
  added: number;
  turns: number;
}

/** box basename → audit id → entries (oldest first). */
export type ContextHistory = Record<string, Record<string, ContextHistoryEntry[]>>;

export interface RunMeasurement {
  auditId: string;
  stats: ContextStats;
}

export interface AppendRunOptions {
  box: string;
  date: string;
  boxCommit: string;
  repoCommit: string;
  measurements: RunMeasurement[];
}

/**
 * Append a run's measurements to the history, returning a new object. Pure —
 * the existing history is not mutated.
 */
export function appendRun(history: ContextHistory, options: AppendRunOptions): ContextHistory {
  const { box, date, boxCommit, repoCommit, measurements } = options;
  const boxHistory: Record<string, ContextHistoryEntry[]> = { ...(history[box] ?? {}) };
  for (const { auditId, stats } of measurements) {
    const entry: ContextHistoryEntry = {
      date,
      boxCommit,
      repoCommit,
      initial: stats.initialTokens,
      peak: stats.peakTokens,
      added: stats.addedTokens,
      turns: stats.turnCount,
    };
    boxHistory[auditId] = [...(boxHistory[auditId] ?? []), entry];
  }
  return { ...history, [box]: boxHistory };
}

const HISTORY_HEADER =
  "# Context-size history — auto-appended by `knowledge-audit run`.\n" +
  "# box basename → audit id → entries (oldest first). See lib/context-history.ts.\n";

/**
 * Load the history file (empty if absent), append this run's measurements, and
 * write it back. A missing file is the normal first-run case; any other read
 * error is real and propagates.
 */
export async function recordRun(
  options: AppendRunOptions & { historyPath: string },
): Promise<void> {
  const { historyPath, ...run } = options;
  let history: ContextHistory = {};
  try {
    const text = await fs.readFile(historyPath, "utf-8");
    history = (YAML.parse(text) as ContextHistory | null) ?? {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const next = appendRun(history, run);
  await fs.writeFile(historyPath, HISTORY_HEADER + YAML.stringify(next), "utf-8");
}

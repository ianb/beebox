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
import { z } from "zod";
import type { ContextStats } from "./context-usage.js";
import { errnoCode } from "../../lib/error-guards.js";

const contextHistoryEntrySchema = z.object({
  date: z.string(),
  boxCommit: z.string(),
  repoCommit: z.string(),
  initial: z.number(),
  peak: z.number(),
  added: z.number(),
  turns: z.number(),
});
export type ContextHistoryEntry = z.infer<typeof contextHistoryEntrySchema>;

/** box basename → audit id → entries (oldest first). */
const contextHistorySchema = z.record(
  z.string(),
  z.record(z.string(), z.array(contextHistoryEntrySchema)),
);
export type ContextHistory = z.infer<typeof contextHistorySchema>;

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
 * Load the history file, returning an empty history when it doesn't exist yet
 * (the normal first-run case). Any other read error is real and propagates.
 */
export async function loadHistory(historyPath: string): Promise<ContextHistory> {
  try {
    const text = await fs.readFile(historyPath, "utf-8");
    // Parse boundary: this is a committed, tool-maintained ledger, so a
    // present-but-malformed file is a real bug — `.parse()` throws rather
    // than casting past it. An empty/all-comments file parses to `null`,
    // which is the normal "no history yet" case (same as ENOENT below).
    const parsed: unknown = YAML.parse(text);
    return parsed === null ? {} : contextHistorySchema.parse(parsed);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    return {};
  }
}

/**
 * Load the history, append this run's measurements, and write it back.
 */
export async function recordRun(
  options: AppendRunOptions & { historyPath: string },
): Promise<void> {
  const { historyPath, ...run } = options;
  const history = await loadHistory(historyPath);
  const next = appendRun(history, run);
  await fs.writeFile(historyPath, HISTORY_HEADER + YAML.stringify(next), "utf-8");
}

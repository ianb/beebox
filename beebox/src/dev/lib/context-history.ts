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

/**
 * Outer shape only — each entry is validated individually in
 * {@link parseContextHistory} so one malformed row can be warned about and
 * skipped instead of rejecting the whole committed ledger.
 */
const rawContextHistorySchema = z.record(
  z.string(),
  z.record(z.string(), z.array(z.unknown())),
);

/** box basename → audit id → entries (oldest first). */
const contextHistorySchema = z.record(
  z.string(),
  z.record(z.string(), z.array(contextHistoryEntrySchema)),
);
export type ContextHistory = z.infer<typeof contextHistorySchema>;

/**
 * Validate a parsed history document entry by entry, warning about and
 * dropping any row that doesn't match {@link contextHistoryEntrySchema}
 * instead of rejecting the whole ledger. A single hand-edited or
 * merge-mangled row (see the 2026-08-23 `points-at-ui-path-vs-control`
 * incident, where a merge conflict resolution silently dropped an entry's
 * `added`/`turns` lines) must not block every other audit id from recording.
 */
function parseContextHistory(raw: unknown): ContextHistory {
  const shaped = rawContextHistorySchema.parse(raw);
  const result: ContextHistory = {};
  for (const [box, audits] of Object.entries(shaped)) {
    const boxHistory: Record<string, ContextHistoryEntry[]> = {};
    for (const [auditId, entries] of Object.entries(audits)) {
      const valid: ContextHistoryEntry[] = [];
      for (const [index, entry] of entries.entries()) {
        const parsed = contextHistoryEntrySchema.safeParse(entry);
        if (parsed.success) {
          valid.push(parsed.data);
        } else {
          console.warn(
            `context-history: malformed entry for audit "${auditId}" ` +
              `(box "${box}", index ${index}) is ignored and will be dropped ` +
              "by the next recorded run; repair it in the ledger to keep it: " +
              `${parsed.error.message}`,
          );
        }
      }
      boxHistory[auditId] = valid;
    }
    result[box] = boxHistory;
  }
  return result;
}

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
    return parsed === null ? {} : parseContextHistory(parsed);
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
  // Validate the whole document (not just the entries this run added) right
  // before it becomes the new committed ledger — a cheap backstop so a
  // future bug that shapes `next` incorrectly fails loudly here rather than
  // writing a row later runs will need to warn-and-skip past.
  contextHistorySchema.parse(next);
  await fs.writeFile(historyPath, HISTORY_HEADER + YAML.stringify(next), "utf-8");
}

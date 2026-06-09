/**
 * Observation ledger — the append-only record behind recurrence.
 *
 * Lives at `.callback-box/retro/observations.jsonl` (box-local machine
 * state). The integrator reads the full ledger to judge recurrence
 * across runs; the scanner reads the evidence hashes to drop exact
 * duplicates before they ever land.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { ObservationSchema } from "./observations.js";

const LEDGER_FILE = ".callback-box/retro/observations.jsonl";

const LedgerEntrySchema = ObservationSchema.extend({
  runId: z.string(),
  sessionId: z.string(),
  threadRef: z.string().nullable(),
  evidenceHash: z.string(),
  observedAt: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export async function appendLedgerEntries(
  boxRoot: string,
  entries: LedgerEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  const filePath = path.join(boxRoot, LEDGER_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf-8");
}

/**
 * Read the ledger, skipping blank/corrupt/mismatched lines (a partial
 * write shouldn't poison the whole history — same tolerance as session
 * log parsing).
 */
export async function loadLedgerEntries(boxRoot: string): Promise<LedgerEntry[]> {
  const filePath = path.join(boxRoot, LEDGER_FILE);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`retro: could not read ${LEDGER_FILE}, treating as empty:`, e);
    }
    return [];
  }

  const entries: LedgerEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (_e) {
      console.debug("retro: skipping unparseable ledger line");
      continue;
    }
    const parsed = LedgerEntrySchema.safeParse(raw);
    if (!parsed.success) {
      console.debug("retro: skipping ledger line that doesn't match the entry shape");
      continue;
    }
    entries.push(parsed.data);
  }
  return entries;
}

/** Evidence hashes already in the ledger, for duplicate suppression. */
export async function loadEvidenceHashes(boxRoot: string): Promise<Set<string>> {
  const entries = await loadLedgerEntries(boxRoot);
  return new Set(entries.map((entry) => entry.evidenceHash));
}

/**
 * Observation ledger — the append-only record behind recurrence.
 *
 * Lives at `.beebox/retro/observations.jsonl` (box-local machine
 * state). The integrator reads the full ledger to judge recurrence
 * across runs; the scanner reads the evidence hashes to drop exact
 * duplicates before they ever land.
 */

import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import { z } from "zod";
import { ObservationSchema } from "./observations.js";
import { errnoCode } from "../../lib/error-guards.js";

const LEDGER_FILE = ".beebox/retro/observations.jsonl";

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
 *
 * Streamed line by line rather than read whole: the ledger is append-forever
 * (one line per observation per nightly run), so a whole-file read plus split
 * holds two copies of it at once.
 */
export async function loadLedgerEntries(boxRoot: string): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  await forEachLedgerEntry(boxRoot, (entry) => { entries.push(entry); });
  return entries;
}

/** Evidence hashes already in the ledger, for duplicate suppression. */
export async function loadEvidenceHashes(boxRoot: string): Promise<Set<string>> {
  // Built as the lines stream past: the scanner wants only the hashes, so
  // materializing every entry first would retain the whole ledger for nothing.
  const hashes = new Set<string>();
  await forEachLedgerEntry(boxRoot, (entry) => { hashes.add(entry.evidenceHash); });
  return hashes;
}

async function forEachLedgerEntry(boxRoot: string, visit: (entry: LedgerEntry) => void): Promise<void> {
  const filePath = path.join(boxRoot, LEDGER_FILE);
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
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
      visit(parsed.data);
    }
  } catch (e) {
    // Open and read errors both surface here (the stream opens lazily). A
    // missing ledger is the empty ledger; anything else is empty-but-visible.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`retro: could not read ${LEDGER_FILE}, treating as empty:`, e);
    }
  } finally {
    lines.close();
    stream.close();
  }
}

/**
 * The scan promote worker (Track 2 chunk 2 / Track 3 of
 * `docs/plans/scanner-ingest.md`).
 *
 * One pass drives everything quarantine owes the box: pending entries through
 * `bbx upload --as scan` into the inbox, rejected ones into question cards, the
 * owed `bbx wakeup`, and the GC that keeps `tmp/scan-quarantine/` from growing
 * forever. It runs debounced (no new PUT for two minutes — a ten-document scan
 * session becomes one batch and one wakeup) and once at box-serve startup, and
 * it is safe to run at any other time.
 *
 * Three properties are deliberate:
 *
 *   - **A per-box cross-process promotion lock** (`file-lock.ts`). The `bbx
 *     serve` child and a hand-run CLI are different processes; both may promote.
 *     A pass that finds the lock held does nothing and says so — the holder is
 *     already doing this work.
 *   - **The sidecar is the state, not memory.** Entries are marked `promoting`
 *     before any work, so a crash mid-batch is recovered by the next pass
 *     re-driving them; re-running `bbx upload` is safe because the upload ledger
 *     dedups on content hash.
 *   - **Files are materialized under their ORIGINAL sanitized filenames**, not
 *     their hash names, because scan-import groups images by scanner
 *     `<prefix>_NNN` naming and records the basename as provenance. Hash-named
 *     inputs would wreck both.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { boxTmpDir } from "../../lib/box-tmp.js";
import { runCommand, createCollectorContext } from "../commands/index.js";
import {
  readAllQuarantineEntries,
  quarantineFilePath,
  updateQuarantineState,
  type ScanQuarantineEntry,
} from "./quarantine.js";
import { collectQuarantine } from "./promote-gc.js";
import { emitRejectionQuestions } from "./promote-questions.js";
import {
  markWakeupPending,
  runPendingWakeup,
  spawnBbxWakeup,
  type WakeupOutcome,
  type WakeupRunner,
} from "./promote-wakeup.js";
import { isAnnexBox } from "../annex/is-annex-box.js";

// A batch that promoted nothing still owes no wakeup of its own, but a marker
// left by an earlier pass is always retried — see `runPendingWakeup`.

/** Staging area the batch is materialized into, beside the quarantine dir. */
const STAGING_DIR_NAME = "scan-staging";

/** Run one `bbx upload --as scan` over a materialized group. Injected in tests. */
export type UploadRunner = (opts: {
  boxRoot: string;
  files: string[];
  source: string;
}) => Promise<{ ok: boolean; detail: string }>;

export interface ScanPromoteDeps {
  runUpload?: UploadRunner | undefined;
  runWakeup?: WakeupRunner | undefined;
}

export interface ScanPromoteResult {
  /**
   * Why the pass did nothing: `locked` (another process held the promotion
   * lock) or `not-annex` (the box cannot import asset bytes at all).
   */
  skipped: "locked" | "not-annex" | null;
  /** Entries that reached `imported` this pass. */
  imported: number;
  /** Entries left in `promoting` because their upload failed. */
  failed: number;
  /** Question cards written for rejections. */
  questions: number;
  wakeup: WakeupOutcome;
  importedRemoved: number;
  tombstoned: number;
  tombstonesRemoved: number;
}

export function promotionLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "scan-promote.lock");
}

function stagingBaseDir(boxRoot: string): string {
  return path.join(boxTmpDir(boxRoot), STAGING_DIR_NAME);
}

/** Provenance for one entry — the vocabulary the plan locks in. */
function sourceOf(entry: ScanQuarantineEntry): string {
  return `scan-upload/${entry.tokenName ?? "owner"}`;
}

/** `Invoice.pdf` taken → `Invoice-2.pdf`. Collisions are within one batch only. */
function uniqueName(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) return filename;
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The real upload runner: the `upload` command with kind `scan`. */
const defaultUploadRunner: UploadRunner = async ({ boxRoot, files, source }) => {
  const { ctx, getOutput } = createCollectorContext(boxRoot);
  const result = await runCommand({ name: "upload", args: { files, kind: "scan", source }, ctx });
  if (result.success) return { ok: true, detail: "" };
  return { ok: false, detail: `${result.error ?? "upload failed"}\n${getOutput()}`.trim() };
};

/**
 * Copy one group's files into a fresh staging dir under their original names.
 * An entry whose stored bytes have vanished is rejected rather than retried
 * forever — the next pass raises a question card saying so.
 */
async function materializeGroup(opts: {
  boxRoot: string;
  entries: ScanQuarantineEntry[];
  stagingDir: string;
}): Promise<{ files: string[]; staged: ScanQuarantineEntry[] }> {
  const { boxRoot, entries, stagingDir } = opts;
  await fs.mkdir(stagingDir, { recursive: true });
  const taken = new Set<string>();
  const files: string[] = [];
  const staged: ScanQuarantineEntry[] = [];
  for (const entry of entries) {
    const name = uniqueName(taken, entry.originalFilename);
    const dest = path.join(stagingDir, name);
    try {
      await fs.copyFile(quarantineFilePath(boxRoot, entry.storedFilename), dest);
    } catch (e) {
      console.error(`[scan] Quarantined bytes for ${entry.originalFilename} (${entry.sha256.slice(0, 12)}) are gone:`, e);
      await updateQuarantineState(boxRoot, {
        sha256: entry.sha256,
        state: "rejected",
        reason: "the quarantined copy disappeared before it could be imported",
      });
      continue;
    }
    taken.add(name);
    files.push(dest);
    staged.push(entry);
  }
  return { files, staged };
}

/** Promote every `pending`/`promoting` entry, grouped by uploading credential. */
async function promoteBatch(opts: {
  boxRoot: string;
  entries: ScanQuarantineEntry[];
  runUpload: UploadRunner;
}): Promise<{ imported: number; failed: number }> {
  const { boxRoot, entries, runUpload } = opts;
  const batch = entries.filter((e) => e.state === "pending" || e.state === "promoting");
  if (batch.length === 0) return { imported: 0, failed: 0 };

  // Provenance is per-entry, and `--source` is per-invocation, so one upload
  // per credential rather than one per batch.
  const groups = new Map<string, ScanQuarantineEntry[]>();
  for (const entry of batch) {
    const source = sourceOf(entry);
    const existing = groups.get(source);
    if (existing) existing.push(entry);
    else groups.set(source, [entry]);
  }

  // Before any import, not after: a crash between marking an entry `imported`
  // and writing the marker would otherwise lose the wakeup for good — recovery
  // would find nothing promotable and the intake job would sit undrained
  // (connector-scoped scheduled wakeups never touch a `source: scan` job). An
  // unnecessary wakeup after a failed batch is the cheap side of that trade.
  await markWakeupPending(boxRoot, `${batch.length} scan file(s) entering promote`);

  let imported = 0;
  let failed = 0;
  for (const [source, group] of [...groups.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    for (const entry of group) {
      await updateQuarantineState(boxRoot, { sha256: entry.sha256, state: "promoting" });
    }
    const stagingDir = path.join(stagingBaseDir(boxRoot), randomUUID().slice(0, 8));
    try {
      const { files, staged } = await materializeGroup({ boxRoot, entries: group, stagingDir });
      if (files.length === 0) continue;
      const result = await runUpload({ boxRoot, files, source });
      if (!result.ok) {
        // Left in `promoting`: the next pass re-drives it, and the ledger makes
        // a re-run of a partially-succeeded upload a no-op.
        console.error(`[scan] Promote of ${files.length} file(s) from ${source} failed: ${result.detail}`);
        failed += staged.length;
        continue;
      }
      for (const entry of staged) {
        await updateQuarantineState(boxRoot, { sha256: entry.sha256, state: "imported" });
      }
      imported += staged.length;
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
  return { imported, failed };
}

/**
 * Run one full promote pass. Safe to call concurrently from anywhere: a pass
 * that cannot take the lock returns `skipped: "locked"` without touching disk.
 */
export async function runScanPromotePass(opts: {
  boxRoot: string;
  deps?: ScanPromoteDeps | undefined;
}): Promise<ScanPromoteResult> {
  const { boxRoot } = opts;
  const runUpload = opts.deps?.runUpload ?? defaultUploadRunner;
  const runWakeup = opts.deps?.runWakeup ?? spawnBbxWakeup;
  const lockPath = promotionLockPath(boxRoot);

  // Re-probed every pass rather than once at registration: a box can be
  // de-annexed while the server runs (an older `bbx init`, a hand-edited
  // `.gitignore`), and a pass on such a box would drive every pending entry
  // through an upload that cannot succeed — burning the retry budget and
  // leaving entries stuck in `promoting`. Two small file reads, against work
  // that spawns a subprocess per group. The routes refuse in the same
  // condition (see webapp/routes/scan-upload.ts), so on a box that was never
  // converted there is nothing here to skip.
  if (!(await isAnnexBox(boxRoot))) {
    console.error(
      `[scan] Box ${boxRoot} is not annex-converted; skipping the promote pass. ` +
        "Quarantined files stay put until it is converted (`bbx attachments to-annex`).",
    );
    return {
      skipped: "not-annex", imported: 0, failed: 0, questions: 0, wakeup: { kind: "not-needed" },
      importedRemoved: 0, tombstoned: 0, tombstonesRemoved: 0,
    };
  }

  try {
    await acquireLock(lockPath, { purpose: "scan-promote" });
  } catch (e) {
    if (e instanceof LockHeldError) {
      return {
        skipped: "locked", imported: 0, failed: 0, questions: 0, wakeup: { kind: "not-needed" },
        importedRemoved: 0, tombstoned: 0, tombstonesRemoved: 0,
      };
    }
    throw e;
  }

  try {
    // We hold the lock, so nothing else owns any staging dir: whatever is here
    // is a crashed pass's leftovers, and the entries it staged are still
    // `promoting` in their sidecars and get re-driven below.
    await fs.rm(stagingBaseDir(boxRoot), { recursive: true, force: true });

    const entries = await readAllQuarantineEntries(boxRoot);
    const questions = await emitRejectionQuestions({ boxRoot, entries });
    const { imported, failed } = await promoteBatch({ boxRoot, entries, runUpload });
    // Leave nothing behind, not even the empty parent: staging is scratch that
    // only ever exists between the copy and the upload.
    await fs.rm(stagingBaseDir(boxRoot), { recursive: true, force: true });
    // One attempt per pass, whether the marker is this batch's or a previous
    // pass's leftover — so a retry never turns into two wakeups.
    const wakeup = await runPendingWakeup({ boxRoot, runWakeup });

    const gc = await collectQuarantine({ boxRoot, entries: await readAllQuarantineEntries(boxRoot) });
    return { skipped: null, imported, failed, questions, wakeup, ...gc };
  } finally {
    await releaseLock(lockPath);
  }
}

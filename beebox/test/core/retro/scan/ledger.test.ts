// # Retro observation ledger
//
// `.beebox/retro/observations.jsonl` is append-forever — one line per
// observation per nightly run — so both readers stream it line by line rather
// than reading the file whole and splitting it. `loadEvidenceHashes` builds its
// Set as the lines go past, without ever materializing the entries.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { appendLedgerEntries, loadEvidenceHashes, loadLedgerEntries } from "../../../../src/core/retro/scan/ledger.js";
import type { LedgerEntry } from "../../../../src/core/retro/scan/ledger.js";

const entry = (n: number): LedgerEntry => ({
  kind: "preference",
  evidence: `evidence ${n}`,
  proposal: `observation ${n}`,
  sink: "personality",
  runId: "run-1",
  sessionId: `s-${n}`,
  threadRef: null,
  evidenceHash: `hash-${n}`,
  observedAt: "2026-08-25T00:00:00Z",
});

// ## A missing ledger reads as empty
void test("A missing ledger reads as empty", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L31
  const box = await makeTmpBox();
  t.check(await loadLedgerEntries(box.root), []);

  // doctest:L35
  t.check(await loadEvidenceHashes(box.root), new Set());
});

// ## Entries round-trip, and hashes come back as a Set
//
// Blank and corrupt lines are skipped rather than poisoning the history — a
// partial append shouldn't lose everything written before it.
void test("Blank and corrupt lines are skipped rather than poisoning the history — a par...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L49
  const box = await makeTmpBox();
  await appendLedgerEntries(box.root, [entry(1), entry(2)]);
  const ledgerPath = join(box.root, ".beebox/retro/observations.jsonl");
  await appendFile(ledgerPath, "\n{not json}\n" + JSON.stringify({ missing: "fields" }) + "\n");
  await appendLedgerEntries(box.root, [entry(3)]);

  // doctest:L55
  t.check(await loadLedgerEntries(box.root), [entry(1), entry(2), entry(3)]);

  // doctest:L60
  t.check(await loadEvidenceHashes(box.root), new Set(["hash-1", "hash-2", "hash-3"]));
});

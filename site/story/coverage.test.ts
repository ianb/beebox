// Tests for the coverage-ledger core (buildLedger): per-doc aggregation across
// runs, drift detection against the scanned hash, provenance (scanned-text vs
// current-file), and byte-for-byte determinism. Run with:
//   node --import tsx --test site/story/coverage.test.ts   (or `pnpm --dir site test`)

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLedger, type RunFileRecord } from "./coverage.js";

// Mirror of coverage.ts's local contentHash, so tests can predict a doc's hash.
function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const NOW = "2026-07-22T00:00:00.000Z";

function record(overrides: Partial<RunFileRecord> & Pick<RunFileRecord, "run" | "doc">): RunFileRecord {
  return { variant: "v1", nuggetCount: 1, docText: undefined, ...overrides };
}

test("aggregates a doc across runs; latest scanned-text wins the hash", () => {
  const records = [
    record({ run: "run-001", doc: "a.md", variant: "v1", nuggetCount: 3 }),
    record({ run: "run-002", doc: "a.md", variant: "v2", nuggetCount: 2, docText: "HELLO" }),
  ];
  const ledger = buildLedger({
    records,
    currentHashByDoc: new Map([["a.md", hash("HELLO")]]),
    now: NOW,
  });
  assert.equal(ledger.docs.length, 1);
  const doc = ledger.docs[0];
  assert.deepEqual(doc?.runs, ["run-001", "run-002"]);
  assert.deepEqual(doc?.variants, ["v1", "v2"]);
  assert.equal(doc?.nuggetCount, 5);
  assert.equal(doc?.hashSource, "scanned-text");
  assert.equal(doc?.scannedContentHash, hash("HELLO"));
  assert.equal(doc?.current, true);
});

test("scanned-text hash mismatch is flagged as drifted", () => {
  const records = [record({ run: "run-002", doc: "b.md", docText: "ORIGINAL" })];
  const ledger = buildLedger({
    records,
    currentHashByDoc: new Map([["b.md", hash("CHANGED ON DISK")]]),
    now: NOW,
  });
  assert.equal(ledger.docs[0]?.hashSource, "scanned-text");
  assert.equal(ledger.docs[0]?.current, false);
});

test("a run file without docText uses current-file provenance and is trivially current", () => {
  const records = [record({ run: "run-001", doc: "c.md" })];
  const ledger = buildLedger({
    records,
    currentHashByDoc: new Map([["c.md", hash("whatever is on disk")]]),
    now: NOW,
  });
  assert.equal(ledger.docs[0]?.hashSource, "current-file");
  assert.equal(ledger.docs[0]?.current, true);
});

test("docs are sorted by path and two generations are byte-identical", () => {
  const records = [
    record({ run: "run-001", doc: "z.md" }),
    record({ run: "run-001", doc: "a.md" }),
  ];
  const currentHashByDoc = new Map([
    ["z.md", hash("z")],
    ["a.md", hash("a")],
  ]);
  const first = buildLedger({ records, currentHashByDoc, now: NOW });
  const second = buildLedger({ records, currentHashByDoc, now: NOW });
  assert.deepEqual(
    first.docs.map((d) => d.doc),
    ["a.md", "z.md"],
  );
  assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));
});

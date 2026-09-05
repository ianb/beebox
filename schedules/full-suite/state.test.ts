import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  newlyRedFiles,
  nextKnownRed,
  nextPendingAfterUntrusted,
  readKnownRed,
  readLastAlert,
  readPending,
  writeKnownRed,
  writeLastAlert,
  writePending,
} from "./state.js";

test("a red file present at baseline files nothing", () => {
  assert.deepEqual(newlyRedFiles({ known: ["test/a.test.ts"], current: ["test/a.test.ts"] }), []);
});

test("a new red file files once", () => {
  assert.deepEqual(newlyRedFiles({ known: [], current: ["test/a.test.ts"] }), ["test/a.test.ts"]);
});

test("the same red file across three consecutive runs files once total", () => {
  let known: string[] = [];
  let reports = 0;
  for (let run = 0; run < 3; run++) {
    const current = ["test/a.test.ts"];
    reports += newlyRedFiles({ known, current }).length;
    known = nextKnownRed(current);
  }
  assert.equal(reports, 1);
});

test("a pending entry keeps its original base across later untrusted runs", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const first = nextPendingAfterUntrusted({
    pending: {},
    failures: ["test/a.test.ts"],
    base: "1".repeat(40),
    now,
  });
  // The next hour's untrusted run has a NEWER base (its marker moved on), but
  // the file must still bisect from where it first failed.
  const second = nextPendingAfterUntrusted({
    pending: first,
    failures: ["test/a.test.ts", "test/b.test.ts"],
    base: "2".repeat(40),
    now: new Date("2026-09-01T01:00:00Z"),
  });
  assert.equal(second["test/a.test.ts"]?.base, "1".repeat(40));
  assert.equal(second["test/b.test.ts"]?.base, "2".repeat(40));
});

test("pending and last-alert state round-trip, and clear", async () => {
  const directory = await mkdtemp(join(tmpdir(), "full-suite-state-"));
  const previous = process.env["SCHEDULE_STATE_DIR"];
  process.env["SCHEDULE_STATE_DIR"] = directory;
  try {
    assert.deepEqual(await readPending(), {});
    const entry = { base: "1".repeat(40), firstSeen: "2026-09-01T00:00:00.000Z" };
    await writePending({ "test/a.test.ts": entry });
    assert.deepEqual(await readPending(), { "test/a.test.ts": entry });
    await writePending({});
    assert.deepEqual(await readPending(), {});

    assert.equal(await readLastAlert(), null);
    await writeLastAlert({ fingerprint: "deferred:test/a.test.ts", raisedAt: "2026-09-01T00:00:00.000Z" });
    assert.equal((await readLastAlert())?.fingerprint, "deferred:test/a.test.ts");
    await writeLastAlert(null);
    assert.equal(await readLastAlert(), null);
  } finally {
    if (previous === undefined) delete process.env["SCHEDULE_STATE_DIR"];
    else process.env["SCHEDULE_STATE_DIR"] = previous;
    await rm(directory, { recursive: true });
  }
});

test("durable state starts empty, round-trips, and recovery drops a red file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "full-suite-state-"));
  const previous = process.env["SCHEDULE_STATE_DIR"];
  process.env["SCHEDULE_STATE_DIR"] = directory;
  try {
    assert.deepEqual(await readKnownRed(), []);
    await writeKnownRed(["test/a.test.ts"]);
    assert.deepEqual(await readKnownRed(), ["test/a.test.ts"]);
    await writeKnownRed([]);
    assert.deepEqual(await readKnownRed(), []);
    assert.deepEqual(newlyRedFiles({ known: await readKnownRed(), current: ["test/a.test.ts"] }), ["test/a.test.ts"]);
  } finally {
    if (previous === undefined) delete process.env["SCHEDULE_STATE_DIR"];
    else process.env["SCHEDULE_STATE_DIR"] = previous;
    await rm(directory, { recursive: true });
  }
});

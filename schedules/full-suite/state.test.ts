import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newlyRedFiles, nextKnownRed, readKnownRed, writeKnownRed } from "./state.js";

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

// # Splitting oversized intake jobs
//
// Before the 25-item cap, one intake job grew to 300 items and its batch prompt
// passed the model's limit. Every wakeup now splits an intake job over the cap
// into jobs of at most 25 (`splitOversizedIntakeJobs`, committed by the wakeup's
// `splitOversizedJobs`). Chunk names derive from the original's, so a split
// stopped partway resumes without a second set, and each chunk is published
// atomically, so a file under a chunk's name is always complete. See
// docs/plans/bounded-reactor-batches.md, Track B.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execSync } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { splitOversizedIntakeJobs } from "../../src/job-cards/intake-utils.js";
import { splitOversizedJobs } from "../../src/cli/commands/wakeup/steps.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { checkWaitingJobs } from "../../src/core/schedule/job-check/core.js";

const BASE = "2026-09-01T00-00-00-scan";
const ORIGINAL = `_bookkeeping/jobs/${BASE}.intake.job.card`;
const refs = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `_content/inbox/s-${String(from + i).padStart(3, "0")}.capture-session.card`);
const part = (n: number): string => `_bookkeeping/jobs/${BASE}-part-${String(n).padStart(2, "0")}.intake.job.card`;
const parts = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => part(from + i));
const itemsOf = (card: string): string[] => card.split("\n").filter((l) => l.startsWith("  - ref: ")).map((l) => l.slice(9));

async function boxWithOversizedJob(t: Test): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write(ORIGINAL, createIntakeJobTemplate({ priority: "normal", description: "Triage 3 inbox items", items: refs(0, 300) }));
  box.commitAll("legacy oversized job");
  return box;
}

async function jobFiles(box: TmpBox): Promise<string[]> {
  return (await readdir(join(box.root, "_bookkeeping/jobs"))).filter((f) => f.endsWith(".job.card")).map((f) => `_bookkeeping/jobs/${f}`).toSorted();
}

// ## A 300-item job becomes twelve jobs of 25, in one commit
//
// Items keep their order and the job keeps its key; each chunk's description
// counts its own items. A 25-item job is left alone, and so is a job of another
// type, whatever its size.
void test("A 300-item job becomes twelve jobs of 25, in one commit", async (t) => {
  const box = await boxWithOversizedJob(t);
  await box.write("_bookkeeping/jobs/2026-09-02T00-00-00-inbox.intake.job.card", createIntakeJobTemplate({ priority: "normal", description: "full", items: refs(500, 25) }));
  await box.write("_bookkeeping/jobs/2026-09-03T00-00-00-big.contains-backfill.job.card", `---\npriority: low\nitems:\n${refs(600, 300).map((r) => `  - ref: ${r}`).join("\n")}\n---\n`);
  box.commitAll("other jobs");

  const log: string[] = [];
  const consoleLog = console.log;
  console.log = (line: string) => log.push(line);
  let count: number;
  try {
    count = await splitOversizedJobs(box.root);
  } finally {
    console.log = consoleLog;
  }
  const first = await box.read(part(1));
  const chunkItems = await Promise.all(parts(1, 12).map(async (p) => itemsOf(await box.read(p))));
  t.check(
    {
      count,
      files: await jobFiles(box),
      first: first.split("\n").slice(0, 3),
      items: chunkItems.flat(),
      sizes: chunkItems.map((items) => items.length),
      commit: execSync("git log -1 '--format=%s%n%(trailers:key=Phase,valueonly)'", { cwd: box.root }).toString().trim(),
      status: execSync("git status --porcelain", { cwd: box.root }).toString().trim(),
      log,
    },
    {
      count: 1,
      files: [...parts(1, 12), "_bookkeeping/jobs/2026-09-02T00-00-00-inbox.intake.job.card", "_bookkeeping/jobs/2026-09-03T00-00-00-big.contains-backfill.job.card"],
      first: ["---", "priority: normal", "description: Triage 25 inbox items"],
      items: refs(0, 300),
      sizes: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25],
      commit: "Split intake job 2026-09-01T00-00-00-scan.intake.job.card into 12 jobs of at most 25 items\nintake-split",
      status: "",
      log: ["  Split _bookkeeping/jobs/2026-09-01T00-00-00-scan.intake.job.card into 12 jobs"],
    },
  );

  // The chunks keep the original's place: discovery lists them before a newer
  // job of the same priority.
  await box.write("_bookkeeping/jobs/2026-10-27T00-00-00-q.question-followup.job.card", "---\npriority: normal\n---\n");
  const order = (await findJobCards(join(box.root, "_bookkeeping/jobs"))).map((j) => j.file);
  t.check(order.slice(10, 14), [
    `${BASE}-part-11.intake.job.card`,
    `${BASE}-part-12.intake.job.card`,
    "2026-09-02T00-00-00-inbox.intake.job.card",
    "2026-10-27T00-00-00-q.question-followup.job.card",
  ]);
});

// ## A split stopped partway resumes under the same names
//
// Chunks 1 to 5 were written (chunk 5 has since received an appended item) and
// the original is still there. The next split writes 6 to 12, leaves 1 to 5 as
// they are, and deletes the original: twelve chunks, never a second set.
void test("A split stopped partway resumes under the same names", async (t) => {
  const box = await boxWithOversizedJob(t);
  for (let n = 1; n <= 5; n++) {
    const items = n === 5 ? [...refs(100, 25).slice(0, 24), "_content/inbox/late.doc.card"] : refs((n - 1) * 25, 25);
    await box.write(part(n), createIntakeJobTemplate({ priority: "normal", description: `chunk ${String(n)}`, items }));
  }
  const fifth = await box.read(part(5));
  const splits = await splitOversizedIntakeJobs(box.root);
  t.check({ splits, files: await jobFiles(box), fifth: await box.read(part(5)) }, {
    splits: [{ original: ORIGINAL, chunks: parts(1, 12) }],
    files: parts(1, 12),
    fifth,
  });
});

// ## An interrupted chunk write leaves no chunk under its name
//
// The write of chunk 6 fails partway (the process is killed, the disk fills).
// Chunks are published atomically, so a partial chunk exists only as a temp
// file, never under its final name; the original stays; and the next split
// writes chunk 6 whole.
void test("An interrupted chunk write leaves no chunk under its name", async (t) => {
  const box = await boxWithOversizedJob(t);
  const interrupted = await splitOversizedIntakeJobs(box.root, {
    write: async (filePath, content) => {
      if (filePath.endsWith("-part-06.intake.job.card")) {
        await writeFile(`${filePath}.tmp-interrupted`, content.slice(0, 40));
        throw new Error("killed during the write");
      }
      await writeFile(filePath, content);
    },
  }).catch((e: unknown) => (e instanceof Error ? e.message : "threw"));
  const afterInterrupt = await jobFiles(box);
  await splitOversizedIntakeJobs(box.root);
  t.check({ interrupted, afterInterrupt, sixth: itemsOf(await box.read(part(6))), files: await jobFiles(box) }, {
    interrupted: "killed during the write",
    afterInterrupt: [ORIGINAL, ...parts(1, 5)].toSorted(),
    sixth: refs(125, 25),
    files: parts(1, 12),
  });
});

// ## The job check starts a run for the chunks at once
//
// The check charged the original before the run that split it. The chunks are
// new paths with no entry, so the first pass after the split finds them due.
void test("The job check starts a run for the chunks at once", async (t) => {
  const box = await boxWithOversizedJob(t);
  process.env.BBX_TIME = "2026-10-27T12:00:00Z";
  t.teardown(() => {
    delete process.env.BBX_TIME;
  });
  const started = () => Promise.resolve({ state: "started" as const, detail: "" });
  const before = await checkWaitingJobs(box.root, { start: started });
  await splitOversizedJobs(box.root);
  const after = await checkWaitingJobs(box.root, { start: started });
  t.check({ before, after }, {
    before: { kind: "started", files: [`${BASE}.intake.job.card`] },
    after: { kind: "started", files: parts(1, 12).map((p) => p.replace("_bookkeeping/jobs/", "")) },
  });
});

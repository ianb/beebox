// # Intake Job Creation
//
// `createOrAppendIntakeJob` manages intake job files in a box. It appends items
// to the newest pending job with the same batching key, `(connector, priority)`,
// that has room, and starts new jobs past `INTAKE_JOB_MAX_ITEMS` (25). It
// returns every job path it wrote. A new job's name ends in a random 8-hex
// suffix, so jobs created in the same second never share a name.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not, unordered } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { chmod, readdir } from "node:fs/promises";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { createOrAppendIntakeJob } from "../../src/job-cards/intake-utils.js";
import { findJobCards } from "../../src/core/reactor/job-discovery.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";

/** A new job's path: `<stamp>-<stem>-<8 hex>.intake.job.card`. */
const newJob = (stem: string) =>
  any(String).matches(/^_bookkeeping\/jobs\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z-]+-[\da-f]{8}\.intake\.job\.card$/).includes(`-${stem}-`);
const refs = (from: number, count: number): string[] => Array.from({ length: count }, (_, i) => `_content/inbox/item-${String(from + i).padStart(3, "0")}.doc.card`);
/** The item refs a job card holds, in order. */
const itemsOf = (card: string): string[] => card.split("\n").filter((line) => line.startsWith("  - ref: ")).map((line) => line.slice(9));

// ## Creating a new job
//
// When no matching job exists, a new `.intake.job.card` file is created under `_bookkeeping/jobs/`:
void test("When no matching job exists, a new .intake.job.card file is created under boo...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const [path, ...more] = await createOrAppendIntakeJob({
    boxRoot: box.root,
    connector: "test-connector",
    items: ["_content/inbox/item1.doc.card"],
    description: "Triage 1 item",
  });
  assert.ok(path !== undefined);
  t.check({ path, more }, { path: newJob("test-connector"), more: [] });

  await t.checkText(await box.read(path), `---
connector: test-connector
priority: normal
description: Triage 1 item
items:
  - ref: _content/inbox/item1.doc.card
---`);
});

// ## Appending to an existing job
//
// A second call with the same connector and priority appends to the existing job
// file rather than creating a new one. The appended job's description is
// rewritten from its item count: the caller's text names only its own items.
void test("A second call with the same connector and priority appends to the existing jo...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const [path1] = await createOrAppendIntakeJob({
    boxRoot: box.root,
    connector: "test-connector",
    items: ["_content/inbox/item1.doc.card"],
    description: "Triage 1 item",
  });
  const [path2] = await createOrAppendIntakeJob({
    boxRoot: box.root,
    connector: "test-connector",
    items: ["_content/inbox/item2.doc.card"],
    description: "Triage 2 items",
  });
  assert.ok(path1 !== undefined && path2 !== undefined);
  t.check(path1, path2);

  await t.checkText(await box.read(path2), `---
connector: test-connector
priority: normal
description: Triage 2 inbox items
items:
  - ref: _content/inbox/item1.doc.card
  - ref: _content/inbox/item2.doc.card
---`);
});

// ## Different connectors or priorities get separate jobs
//
// Calls with a different connector, no connector, or a different priority create
// separate job files. The filename stem is the connector's name, or `inbox`
// without one, with `-low` for low priority; the card itself carries no field
// for the no-connector case:
void test("Calls with a different connector, no connector, or a different priority creat...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const created = [
    ...(await createOrAppendIntakeJob({ boxRoot: box.root, connector: "connector-a", items: ["_content/inbox/a.doc.card"], description: "From A" })),
    ...(await createOrAppendIntakeJob({ boxRoot: box.root, connector: "connector-b", items: ["_content/inbox/b.doc.card"], description: "From B" })),
    ...(await createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/c.doc.card"], description: "Inbox" })),
    ...(await createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/d.image.card"], priority: "low", description: "Captures" })),
  ];
  t.check(created.map((p) => p.replace(/^.*T(?:\d{2}-){3}/, "").replace(/-[\da-f]{8}\./, ".")), [
    "connector-a.intake.job.card",
    "connector-b.intake.job.card",
    "inbox.intake.job.card",
    "inbox-low.intake.job.card",
  ]);

  const lowJob = created[3];
  assert.ok(lowJob !== undefined);
  await t.checkText(await box.read(lowJob), `---
priority: low
description: Captures
items:
  - ref: _content/inbox/d.image.card
---`);
});

// ## Concurrent appends to one job keep every item
//
// The find/read/append/write span is a read-modify-write of one card that two
// *processes* genuinely race: the scan promote worker appends to the unscoped
// job from inside `bbx serve` while a full wakeup appends its own inbox items.
// An unlocked append re-renders the whole card, so the loser's items would
// simply vanish. Serializing per batching key (cross-process file lock, plus the
// in-process card lock a PID-blind file lock cannot substitute for) is what
// keeps all eight here.
void test("The find/read/append/write span is a read-modify-write of one card that two p...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const paths = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createOrAppendIntakeJob({
        boxRoot: box.root,
        items: [`_content/inbox/scan-${String(i)}.capture-session.card`],
        description: "Concurrent scan batch",
      })
    )
  );
  const firstPath = paths[0]?.[0];
  assert.ok(firstPath !== undefined);
  const card = await box.read(firstPath);
  t.check(paths, Array.from({ length: 8 }, () => [firstPath]));
  // Append order follows lock acquisition, so the eight item lines match in any order.
  const lines = card.split("\n");
  t.check(
    { head: lines.slice(0, 4), items: lines.slice(4, -2), tail: lines.slice(-2) },
    {
      head: ["---", "priority: normal", "description: Triage 8 inbox items", "items:"],
      items: unordered<string>(Array.from({ length: 8 }, (_, i) => `  - ref: _content/inbox/scan-${String(i)}.capture-session.card`)),
      tail: ["---", ""],
    },
  );
});

// ## Different batching keys don't wait on each other
//
// The lock is per batching key, so a `gmail`-scoped sync and a scan import
// (no connector) proceed in parallel and neither lands in the other's job card.
void test("The lock is per batching key, so a gmail-scoped sync and a scan import (no co...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const [[scanJob], [gmailJob]] = await Promise.all([
    createOrAppendIntakeJob({ boxRoot: box.root, items: ["_content/inbox/a.doc.card"], description: "Scan" }),
    createOrAppendIntakeJob({ boxRoot: box.root, connector: "gmail", items: ["_content/inbox/b.doc.card"], description: "Mail" }),
  ]);
  assert.ok(scanJob !== undefined && gmailJob !== undefined);
  t.check(scanJob, not(gmailJob));
  t.checkText(await box.read(scanJob), `---
priority: normal
description: Scan
items:
  - ref: _content/inbox/a.doc.card
---`);
  t.checkText(await box.read(gmailJob), `---
connector: gmail
priority: normal
description: Mail
items:
  - ref: _content/inbox/b.doc.card
---`);
});

// ## The cap: a job holds at most 25 items
//
// A job with 20 items and a call with 12: the job takes 5 and reaches 25, and
// a new job holds the other 7. The appended job's description comes from its
// count; the new job holds only part of the call, so its description does too.
void test("The cap: a job holds at most 25 items", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card", createIntakeJobTemplate({ priority: "normal", description: "old", items: refs(0, 20) }));
  const written = await createOrAppendIntakeJob({ boxRoot: box.root, items: refs(20, 12), description: "Scan from phone: 12 photos" });
  const [full, fresh] = written;
  assert.ok(full !== undefined && fresh !== undefined);
  const freshCard = await box.read(fresh);
  t.check(
    { written, full: itemsOf(await box.read(full)), fresh: itemsOf(freshCard), freshDescription: freshCard.split("\n")[2] },
    {
      written: ["_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card", newJob("inbox")],
      full: refs(0, 25),
      fresh: refs(25, 7),
      freshDescription: "description: Triage 7 inbox items",
    },
  );
  t.check((await box.read(full)).split("\n")[2], "description: Triage 25 inbox items");
});

// ## The newest job with room receives the append
//
// Two unscoped normal jobs, an older one with 10 items and a newer one with 25
// (full): a new job is not needed for one item, so it goes to the older one,
// the only one with room. With room in both, the newer receives it, so the
// older job's content (and the job check's backoff for it) stays still.
void test("The newest job with room receives the append", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card", createIntakeJobTemplate({ priority: "normal", description: "older", items: refs(0, 10) }));
  await box.write("_bookkeeping/jobs/2026-10-02T00-00-00-inbox.intake.job.card", createIntakeJobTemplate({ priority: "normal", description: "newer", items: refs(100, 25) }));
  const toOlder = await createOrAppendIntakeJob({ boxRoot: box.root, items: refs(200, 1), description: "one" });
  await box.write("_bookkeeping/jobs/2026-10-03T00-00-00-inbox.intake.job.card", createIntakeJobTemplate({ priority: "normal", description: "newest", items: refs(300, 3) }));
  const toNewest = await createOrAppendIntakeJob({ boxRoot: box.root, items: refs(400, 1), description: "one" });
  t.check({ toOlder, toNewest }, {
    toOlder: ["_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card"],
    toNewest: ["_bookkeeping/jobs/2026-10-03T00-00-00-inbox.intake.job.card"],
  });
});

// ## Same-second names stay distinct
//
// Sixty items in one frozen box second make three new jobs (25, 25, 10) with
// three distinct names, and discovery still reads each one's age from its stamp.
void test("Same-second names stay distinct", async (t) => {
  const box = await makeTmpBox();
  process.env.BBX_TIME = "2026-10-27T12:00:00Z";
  t.teardown(async () => {
    delete process.env.BBX_TIME;
    await box.cleanup();
  });
  const written = await createOrAppendIntakeJob({ boxRoot: box.root, items: refs(0, 60), description: "Burst" });
  const counts = await Promise.all(written.map(async (job) => itemsOf(await box.read(job)).length));
  const names = new Set(written);
  const found = await findJobCards(`${box.root}/_bookkeeping/jobs`);
  t.check(
    { counts, distinct: [...names].length, ages: found.map((job) => job.createdAt?.toISOString()) },
    { counts: [25, 25, 10], distinct: 3, ages: ["2026-10-27T12:00:00.000Z", "2026-10-27T12:00:00.000Z", "2026-10-27T12:00:00.000Z"] },
  );
});

// ## A write that fails partway is undone
//
// A job with 20 items and a call with 12: the append of 5 succeeds, then the
// new job for the other 7 cannot be written (here the jobs directory refuses
// new files). The writer throws without returning paths, so no caller would
// commit the appended job, which would hold its new items while the job check
// skipped it. So the append is undone: the job is as it was, and no new file
// is left.
void test("A write that fails partway is undone", async (t) => {
  const box = await makeTmpBox();
  const jobsDir = `${box.root}/_bookkeeping/jobs`;
  t.teardown(async () => {
    await chmod(jobsDir, 0o755);
    await box.cleanup();
  });
  const existing = "_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card";
  await box.write(existing, createIntakeJobTemplate({ priority: "normal", description: "old", items: refs(0, 20) }));
  const before = await box.read(existing);
  await chmod(jobsDir, 0o555);
  const thrown = await createOrAppendIntakeJob({ boxRoot: box.root, items: refs(20, 12), description: "Scan" })
    .then(() => "no error", (e: unknown) => (e instanceof Error && "code" in e ? e.code : "other"));
  t.check({ thrown, job: await box.read(existing), files: (await readdir(jobsDir)).toSorted() }, {
    thrown: "EACCES",
    job: before,
    files: [".gitkeep", "2026-10-01T00-00-00-inbox.intake.job.card"],
  });
});

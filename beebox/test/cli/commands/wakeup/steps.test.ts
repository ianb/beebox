// # contains backfill: wakeup queues one batch at a time
//
// `createContainsBackfillJob` writes a `contains-backfill.job.card` (YAML
// frontmatter) asking a background agent to fill `contains:` on cards missing
// it — one batch per wakeup, no new job while a previous backfill job is still
// pending. The how-to prose lives in the schema's `instructions` (injected into
// the reactor prompt by type), so the card itself just carries the refs and a
// description.
//
// It reads the `contains` state that `refreshSearchIndex` writes, and `bbx wakeup`
// runs the two as separate consecutive steps. They used to be one function, with
// the refresh sitting *below* the "a backfill job is already pending" early
// return — so one undrainable job card removed the box's only scheduled index
// refresh indefinitely. The last section here pins them apart.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createContainsBackfillJob, refreshSearchIndex } from "../../../../src/cli/commands/wakeup/steps.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { searchBox } from "../../../../src/core/search/query/core.js";
import { acquireLock, releaseLock } from "../../../../src/lib/file-lock.js";
import { searchLockPath } from "../../../../src/core/search/store/core.js";

const DOC = (title: string, text: string) =>
  "---\ntitle: " + title + "\n---\n" + text + "\n";

// ## Missing-contains cards produce one pending job card
void test("Missing-contains cards produce one pending job card", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("_content/notes/A.doc.card", DOC("A", "alpha notes"));
  await box.write("_content/notes/B.doc.card", DOC("B", "beta notes"));
  box.commitAll("seed cards");
  await refreshSearchIndex(box.root);
  const queued = await createContainsBackfillJob(box.root);
  t.check(queued, 2);

  // The job card carries its priority, a description, and the item refs:

  const jobFile = (await box.list("_bookkeeping/jobs")).split("\n").find((f) => f.includes("contains-backfill.job.card"));
  const job = await box.read(jobFile ?? "");
  t.check(job, `---
priority: low
description: "Write the contains: field for 2 cards missing it."
items:
  - ref: _content/notes/A.doc.card
  - ref: _content/notes/B.doc.card
---
`);

  // ## A pending backfill job blocks queueing another

  t.check(await createContainsBackfillJob(box.root), 0);
});

// ## Nothing missing → nothing queued
void test("Nothing missing → nothing queued", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox({ git: true });
  await box2.write(
    "_content/notes/Done.doc.card",
    "---\ntitle: Done\ncontains: Already annotated.\n---\nbody\n"
  );
  box2.commitAll("seed");
  await refreshSearchIndex(box2.root);
  t.check(await createContainsBackfillJob(box2.root), 0);
});

// ## The index refresh runs whether or not a backfill job is pending
//
// `refreshSearchIndex` is the box's only *scheduled* reconciliation of the
// search index against the card tree (queries refresh lazily, so a box nobody
// searches has no other). Its execution must not depend on the state of the job
// queue: here a backfill job is already pending — the condition that used to
// suppress the refresh — and a card added afterwards still reaches the index.
void test("refreshSearchIndex is the box's only scheduled reconciliation of the search i...", async (t) => {
  t.teardown(async () => {
    try {
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box3 = await makeTmpBox({ git: true });
  await box3.write("_content/notes/A.doc.card", DOC("A", "alpha notes"));
  box3.commitAll("seed");
  await refreshSearchIndex(box3.root);
  await createContainsBackfillJob(box3.root);

  // With the backfill job still pending, the refresh still indexes a new card.
  await createContainsBackfillJob(box3.root);
  await box3.write("_content/notes/Later.doc.card", DOC("Later", "distinctive kumquat filing"));
  box3.commitAll("add a card");
  t.check(await refreshSearchIndex(box3.root), true);

  const hits = await searchBox(box3.root, { query: "kumquat", mode: "text" });
  t.check(hits, {
    results: [
      {
        path: "_content/notes/Later.doc.card",
        fragment: "",
        kind: "doc",
        title: "Later",
        contains: "",
        excerpt: "distinctive kumquat filing",
        score: 1.7094573800329702,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
    searchMode: "text",
    embeddingsReady: false,
  });
});

// ## A refresh that lost the search lock is not a refresh
//
// `openSearchIndex` degrades under contention: it retries for a few seconds and
// then serves the last persisted index *without reconciling anything*, flagged
// `stale`. That is the right call for a query — slightly stale beats broken —
// but it is not a refresh, and `bbx wakeup` skips the backfill step on a false
// return precisely so a batch is never chosen from `contains` state that
// predates the card tree. Losing the lock is likeliest exactly when this matters
// most: the first run after deploy, when the reconciliation is large and slow.
void test("openSearchIndex degrades under contention:", async (t) => {
  t.teardown(async () => {
    try {
      await box4.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box4 = await makeTmpBox({ git: true });
  await box4.write("_content/notes/A.doc.card", DOC("A", "alpha notes"));
  box4.commitAll("seed");

  // Hold the search lock, as a concurrent query or a second wakeup would.
  await acquireLock(searchLockPath(box4.root), { purpose: "test" });
  t.check(await refreshSearchIndex(box4.root), false);

  // Released, the same call reconciles and reports success.
  await releaseLock(searchLockPath(box4.root));
  t.check(await refreshSearchIndex(box4.root), true);
});

// ## The job filename is stamped in box time
//
// The stamp is not decoration: the reactor reads it back as the card's age to
// decide when this low-priority job has waited long enough, and `bbx health`
// reads it to report a job that never drained. Both compare against
// `getBoxTime`, so the stamp has to come from the same clock — a wall-time stamp
// under a frozen test clock dates the card in the box's own future, and a job
// that is never old is a job that is never overdue.
void test("The stamp is not decoration:", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
      await box5.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  process.env.BBX_TIME = "2026-03-04T05:06:07Z";
  const box5 = await makeTmpBox({ git: true });
  await box5.write("_content/notes/A.doc.card", DOC("A", "alpha notes"));
  box5.commitAll("seed");
  await refreshSearchIndex(box5.root);
  await createContainsBackfillJob(box5.root);

  const queuedName = (await box5.list("_bookkeeping/jobs")).split("\n").find((f) => f.includes("contains-backfill"));
  t.check(queuedName, "_bookkeeping/jobs/2026-03-04T05-06.contains-backfill.job.card");
});

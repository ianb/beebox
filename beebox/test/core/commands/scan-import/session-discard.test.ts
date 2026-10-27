// # A failed import leaves no session behind
//
// The upload ledger records a file's hash only after its import succeeds. An
// import that fails after writing its session, and leaves that session in the
// box, is imported again in full by the next retry. A promote pass whose commit
// failed on every attempt once turned 24 PDFs into 159 staged-but-uncommitted
// sessions this way.
//
// So an import that fails before its commit lands removes what it wrote: the
// session card, its attach scope, any question cards, and their index entries.
// A retry then starts from nothing and produces exactly one session.
//
// Here the box's pre-commit hook refuses the commit, which is how the commit
// failed in production (its `bbx validate` could not get admitted).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { join } from "node:path";
import { chmod, readdir, rm, writeFile } from "node:fs/promises";
import { execa } from "execa";
import Sharp from "sharp";
import { createFakeDocling } from "../../../../src/services/docling/core.js";
import { runPdfMode } from "../../../../src/core/commands/scan-import/pdf.js";
import { runPhotoMode } from "../../../../src/core/commands/scan-import/command.js";
import { queueCommittedSessionIntake } from "../../../../src/core/commands/scan-import/session-discard.js";
import { createIntakeJobTemplate } from "../../../../src/schemas/intake-job.js";
import { createFakeScanVision } from "../../../../src/services/scan-vision.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { textPdf } from "../../../helpers/pdf-fixtures.js";

async function refuseCommits(box: TmpBox) {
  const { stdout } = await execa("git", ["rev-parse", "--git-path", "hooks"], { cwd: box.root });
  const hook = join(box.root, stdout, "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'Work permission has expired' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  return () => rm(hook);
}

async function importPdf(box: TmpBox) {
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, textPdf());
  const docling = createFakeDocling({ markdown: "# Scan\n", pageCount: 1, figureCount: 1 });
  const { ctx } = createCollectorContext(box.root);
  return runPdfMode(ctx, { pdfPath, docling }).then((r) => `imported ${String(r.success)}`, (e) => `threw: ${e.message.split("\n")[0]}`);
}

async function sessions(box: TmpBox) {
  const entries = await readdir(join(box.root, "_content/inbox")).catch(() => []);
  return entries.filter((e) => e.startsWith("scan-")).toSorted();
}

async function questions(box: TmpBox) {
  const entries = await readdir(join(box.root, "_bookkeeping/questions")).catch(() => []);
  return entries.filter((e) => e.endsWith(".question.card"));
}

async function staged(box: TmpBox) {
  const { stdout } = await execa("git", ["diff", "--cached", "--name-only"], { cwd: box.root });
  return stdout === "" ? [] : stdout.split("\n");
}

/** The session card and its attach scope: one import's whole footprint. */
const ONE_SESSION = [str`scan-${any(String)}.attach`, str`scan-${any(String)}.capture-session.card`];

// ## A refused PDF commit is discarded, and the retry imports once
void test("A refused PDF commit is discarded, and the retry imports once", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const allowCommits = await refuseCommits(box);
  t.check(await importPdf(box), "threw: Work permission has expired");

  t.check({ sessions: await sessions(box), staged: await staged(box) }, { sessions: [], staged: [] });

  // A second refused attempt still leaves nothing. Once commits work again, the
  // import produces one session card and its attach scope.

  await importPdf(box);
  t.check(await sessions(box), []);

  await allowCommits();
  t.check(await importPdf(box), "imported true");

  t.check({ sessions: await sessions(box), staged: await staged(box) }, { sessions: ONE_SESSION, staged: [] });
});

// ## Question cards written outside the session go too
//
// A photo import whose analysis fails raises one question per page. Those cards
// live outside the session, so the discard has to remove them by name.
void test("A photo import whose analysis fails raises one question per page.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await refuseCommits(box);
  const imagePaths = [];
  for (const i of [0, 1]) {
    const p = join(box.root, `page-${i}.jpg`);
    await Sharp({ create: { width: 32, height: 24, channels: 3, background: { r: i * 60, g: 40, b: 80 } } }).jpeg().toFile(p);
    imagePaths.push(p);
  }
  const { ctx } = createCollectorContext(box.root);
  const vision = createFakeScanVision({ alwaysFailRetry: "batch" });
  t.check(
    await runPhotoMode(ctx, { vision, imagePaths, sourcePdfPath: null, extraContext: undefined, source: undefined }).then(
      () => "imported",
      () => "refused",
    ),
    "refused",
  );

  t.check(
    { sessions: await sessions(box), questions: await questions(box), staged: await staged(box) },
    { sessions: [], questions: [], staged: [] },
  );
});

// ## A session another writer already committed stays
//
// A wakeup sweep commits the whole tree, and it can land while an import is still
// extracting. The session's early files are then the box's. Deleting them would
// stage a deletion of committed content, so a partly committed session is left
// in place.
void test("A wakeup sweep commits the whole tree, and it can land while an import is sti...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const pdfPath = join(box.root, "incoming.pdf");
  await writeFile(pdfPath, textPdf());
  const docling = createFakeDocling({ markdown: "# Scan\n", pageCount: 1, figureCount: 0 });
  const sweepThenFail = {
    ...docling,
    async extract() {
      await execa("git", ["add", "-A", "_content"], { cwd: box.root });
      await execa("git", ["commit", "-q", "-m", "sweep"], { cwd: box.root });
      throw new Error("extraction crashed");
    },
  };
  const { ctx } = createCollectorContext(box.root);
  t.check(await runPdfMode(ctx, { pdfPath, docling: sweepThenFail }).then(() => "imported", (e) => e.message), "extraction crashed");

  const tracked = (await execa("git", ["ls-files", "_content/inbox"], { cwd: box.root })).stdout;
  const status = (await execa("git", ["status", "--porcelain", "_content/inbox"], { cwd: box.root })).stdout;
  t.check({ tracked, status }, {
    tracked: str`_content/inbox/.gitkeep
_content/inbox/intake/.gitkeep
_content/inbox/scan-${any(String)}.attach/source.attach/source.pdf
_content/inbox/staged/.gitkeep
_content/inbox/triaged/.gitkeep
_content/inbox/triaged/_unsure/.gitkeep
_content/inbox/unhandled/.gitkeep`,
    status: "",
  });
});

// ## After the commit, a triage-queue failure does not fail the import
//
// The ledger records the hash only for an import that succeeded, so failing
// here would bring a second copy on retry. The session is already committed, and
// wakeup queues any inbox card that no job references. Here the intake job's
// lock directory cannot be created.
void test("The ledger records the hash only for an import that succeeded, so failing her...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await rm(join(box.root, ".beebox/intake-job-locks"), { recursive: true, force: true });
  await writeFile(join(box.root, ".beebox/intake-job-locks"), "not a directory");
  t.check(await importPdf(box), "imported true");

  t.check({ sessions: await sessions(box), staged: await staged(box) }, { sessions: ONE_SESSION, staged: [] });
});

// ## Scan intake jobs are committed, or put back
//
// The job check counts only committed jobs, so the scan's intake jobs are
// committed in one commit. Here a job already holds 24 items, and the scan's
// three items fill it and start another; both paths are in `HEAD`.
//
// When that commit is refused (23 more items: 22 fill the second job, one
// starts a third), the jobs are put back as `HEAD` has them: the
// appended job loses the append and the new job is removed. An uncommitted job
// would hold its items (the wakeup counts every job's refs as jobbed) while the
// job check skips it, so the items would wait for nothing; put back, they are
// unjobbed inbox cards that the next wakeup's step 4b jobs and commits.
void test("Scan intake jobs are committed, or put back", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const existing = "_bookkeeping/jobs/2026-10-01T00-00-00-inbox.intake.job.card";
  const old = Array.from({ length: 24 }, (_, i) => `_content/inbox/old-${String(i)}.doc.card`);
  await box.write(existing, createIntakeJobTemplate({ priority: "normal", description: "old", items: old }));
  box.commitAll("existing job");
  const headFiles = async () => (await execa("git", ["ls-tree", "-r", "--name-only", "HEAD", "_bookkeeping/jobs"], { cwd: box.root })).stdout.split("\n");
  const status = async () => (await execa("git", ["status", "--porcelain", "--untracked-files=all", "_bookkeeping/jobs"], { cwd: box.root })).stdout;

  const scan = ["a", "b", "c"].map((n) => `_content/inbox/scan-${n}.capture-session.card`);
  const committed = await queueCommittedSessionIntake(box.root, { items: scan, description: "Scan: 3 photos" });
  t.check({ committed, head: await headFiles(), status: await status() }, {
    committed: [existing, str`_bookkeeping/jobs/${any(String)}-inbox-${any(String)}.intake.job.card`],
    head: ["_bookkeeping/jobs/.gitkeep", existing, committed?.[1] ?? "second job"],
    status: "",
  });

  const second = committed?.[1] ?? "second job";
  const before = await box.read(second);
  const restore = await refuseCommits(box);
  t.teardown(restore);
  const warn = console.warn;
  console.warn = () => {};
  let refused;
  try {
    // 23 items: 22 fill the second job, and one starts a third.
    const burst = Array.from({ length: 23 }, (_, i) => `_content/inbox/burst-${String(i)}.capture-session.card`);
    refused = await queueCommittedSessionIntake(box.root, { items: burst, description: "Scan: 23 photos" });
  } finally {
    console.warn = warn;
  }
  t.check({ refused, second: await box.read(second), head: await headFiles(), status: await status() }, {
    refused: null,
    second: before,
    head: ["_bookkeeping/jobs/.gitkeep", existing, committed?.[1] ?? "second job"],
    status: "",
  });
});

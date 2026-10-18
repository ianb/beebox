// # finishJob
//
// `finishJob` deletes a completed job card and commits the deletion, pulling
// the commit-message context (the job's `description:`) and the `Job-Type`
// trailer from the job card. The description is read from YAML frontmatter — the
// job wire format — not from a legacy `<description>` element.

import { test } from "tap";
import "agent-doctest/tap";
import { finishJob } from "../../src/core/finish-job.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { execSync } from "node:child_process";

const lastCommitMessage = (root: string): string =>
  execSync("git log -1 --format=%B", { cwd: root, stdio: "pipe" }).toString();

// ## Reads the description from frontmatter into the commit message
void test("Reads the description from frontmatter into the commit message", async (t) => {
  // doctest:L21
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/jobs/sweep.intake.job.card",
    createIntakeJobTemplate({
      connector: "gmail",
      description: "Triage 3 inbox items",
      items: [],
    }),
  );
  box.commitAll("Queue job");

  // doctest:L32
  await finishJob({ boxRoot: box.root, jobRelPath: "_bookkeeping/jobs/sweep.intake.job.card" });

  // doctest:L34
  const msg = lastCommitMessage(box.root);

  // doctest:L36
  await t.checkText(
    // The frontmatter description drives the commit subject
    msg.includes("Finish job: Triage 3 inbox items"),
    "true",
  );

  // doctest:L40
  await t.checkText(
    // The job type (from the filename) is recorded as a trailer
    msg.includes("Job-Type: intake"),
    "true",
  );

  // doctest:L44
  await t.checkText(
    // The job card is gone
    (await box.list("_bookkeeping/jobs")).includes("sweep.intake.job.card"),
    "false",
  );

  // doctest:L48
  await box.cleanup();
});

// ## Missing description falls back to a type-only message
void test("Missing description falls back to a type-only message", async (t) => {
  // doctest:L54
  const box = await makeTmpBox({ git: true });
  // A job card whose frontmatter carries no description: field.
  await box.write("_bookkeeping/jobs/bare.intake.job.card", "---\nstatus: pending\n---\n");
  box.commitAll("Queue bare job");

  // doctest:L59
  await finishJob({ boxRoot: box.root, jobRelPath: "_bookkeeping/jobs/bare.intake.job.card" });

  // doctest:L61
  await t.checkText(lastCommitMessage(box.root).includes("Finish intake job"), "true");

  // doctest:L64
  await box.cleanup();
});

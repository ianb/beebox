# finishJob

`finishJob` deletes a completed job card and commits the deletion, pulling
the commit-message context (the job's `description:`) and the `Job-Type`
trailer from the job card. The description is read from YAML frontmatter — the
job wire format — not from a legacy `<description>` element.

```ts setup
import { finishJob } from "../../src/core/finish-job.js";
import { createIntakeJobTemplate } from "../../src/schemas/intake-job.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { execSync } from "node:child_process";

const lastCommitMessage = (root: string): string =>
  execSync("git log -1 --format=%B", { cwd: root, stdio: "pipe" }).toString();
```

## Reads the description from frontmatter into the commit message

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "box/jobs/sweep.intake.job.card",
  createIntakeJobTemplate({
    created: "2026-07-01T00:00:00Z",
    source: "gmail",
    description: "Triage 3 inbox items",
    items: [],
  }),
);
box.commitAll("Queue job");

await finishJob({ boxRoot: box.root, jobRelPath: "box/jobs/sweep.intake.job.card" });

const msg = lastCommitMessage(box.root);

// The frontmatter description drives the commit subject
msg.includes("Finish job: Triage 3 inbox items")
=> true

// The job type (from the filename) is recorded as a trailer
msg.includes("Job-Type: intake")
=> true

// The job card is gone
(await box.list("box/jobs")).includes("sweep.intake.job.card")
=> false

await box.cleanup();
```

## Missing description falls back to a type-only message

```ts
const box = await makeTmpBox({ git: true });
// A job card whose frontmatter carries no description: field.
await box.write("box/jobs/bare.intake.job.card", `---\nstatus: pending\n---\n`);
box.commitAll("Queue bare job");

await finishJob({ boxRoot: box.root, jobRelPath: "box/jobs/bare.intake.job.card" });

lastCommitMessage(box.root).includes("Finish intake job")
=> true

await box.cleanup();
```

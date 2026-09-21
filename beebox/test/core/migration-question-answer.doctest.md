# Answers after a failed migration

A failed migration leaves its question and a record of unfinished maintenance.
Once the owner is gone the box is open, so the boxholder answers through the
ordinary HTTP and CLI paths; the answer's follow-up job and the next bounded
repair both read it. While an owner holds the box, answers are refused.

```ts setup
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createTestServer } from "../helpers/test-server.js";
import { acquireBoxWork, closeBoxMaintenance, acquireBoxMaintenance, boxMaintenanceStatus, boxWorkEnvironment } from "../../src/lib/box-maintenance.js";
import { captureMigrationSnapshot } from "../../src/core/migration-recovery.js";
import { repairMigration, finishMigrationRepair } from "../../src/core/migration-repair.js";
import { createTextQuestionTemplate } from "../../src/schemas/question.js";
import { getBoxDir } from "../../src/lib/paths.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
const exec = promisify(execFile);
```

```ts
const ctx = await createTestServer();
const boxRoot = ctx.boxRoot;
await writeFile(join(boxRoot, "_config/migrations.jsonl"), "");
const snapshot = await captureMigrationSnapshot(boxRoot, "attachments");
let agentPrompt = "";
let invocations = 0;
const repairOptions = { boxRoot, name: "attachments", recoveryRef: snapshot.ref, failure: "collision", code: 1,
  retry: async () => 1, agent: { invokeStructured: async (_schema, args) => {
    invocations += 1; agentPrompt = args.prompt;
    return { success: true, data: { status: "needs-human", reason: "Which version?" } };
  } } };
const question = (await repairMigration(repairOptions)).question;
await finishMigrationRepair(boxRoot, "attachments");
const held = await acquireBoxMaintenance(boxRoot, { reason: "failed migration" });
await held.beginChanges();
const denied = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: question, answer: "Keep both versions" } });
denied.statusCode
=> 503

await held.release();
const response = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: question, answer: "Keep both versions" } });
response.statusCode
=> 200

const record = await boxMaintenanceStatus(boxRoot);
JSON.stringify({ answered: (await readFile(join(boxRoot, question), "utf8")).includes("Keep both versions"), phase: record.phase, owner: record.owner, agents: invocations, jobs: (await readdir(getBoxDir(boxRoot, "jobs"))).filter((file) => file.includes("question-followup")).length })
=> {"answered":true,"phase":"exclusive","owner":null,"agents":1,"jobs":1}

const owner = await acquireBoxMaintenance(boxRoot, { reason: "retry" });
await owner.run(() => repairMigration({ ...repairOptions, retry: async () => 0 }));
agentPrompt.includes("Previous answered question") && agentPrompt.includes("Keep both versions")
=> true

await owner.release();
const cliQuestion = question.replace("-0.question.card", "-1.question.card");
await writeFile(join(boxRoot, cliQuestion), createTextQuestionTemplate({ memo: "Migration attachments", askedAt: "2026-09-14T00:00:00Z", prompt: `Migration: attachments\nRecovery: ${snapshot.ref}`, directive: "Wait for migration repair" }));
await exec(process.execPath, ["--import", import.meta.resolve("tsx"), join(PACKAGE_ROOT, "src/cli/index.ts"), "answer", cliQuestion, "Use the preserved copy"], { cwd: boxRoot });
(await readFile(join(boxRoot, cliQuestion), "utf8")).includes("Use the preserved copy")
=> true

// An answered question stays answered; the record clears when an attempt completes.
const again = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: cliQuestion, answer: "second thoughts" } });
again.statusCode
=> 400

const open = await acquireBoxMaintenance(boxRoot, { reason: "done" });
await open.complete();
await boxMaintenanceStatus(boxRoot)
=> null

const ordinary = "_bookkeeping/questions/Ordinary.question.card";
await writeFile(join(boxRoot, ordinary), createTextQuestionTemplate({ memo: "Question", askedAt: "2026-09-14T00:00:00Z", prompt: "Proceed?", directive: "Process answer" }));
const accepted = await acquireBoxWork(boxRoot, { reason: "test" });
const drain = await closeBoxMaintenance(boxRoot, { reason: "drain accepted answer" });
const normal = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", headers: { "x-bbx-box-work": accepted.run(boxWorkEnvironment).BBX_BOX_WORK }, payload: { questionPath: ordinary, answer: "yes" } });
normal.statusCode
=> 200

(await readdir(getBoxDir(boxRoot, "jobs"))).filter((file) => file.includes("question-followup")).length
=> 3

await accepted.release();
await drain.drain();
await drain.complete();
```

```ts cleanup
await ctx.cleanup();
```

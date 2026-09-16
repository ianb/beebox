# Answers during migration recovery

The real HTTP and CLI boundaries record a pending migration's human answer
without starting a generic agent or opening admission. The bounded repair reads
that answer on its next attempt. Other question writes remain refused.

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
await held.release();
const response = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: question, answer: "Keep both versions" } });
response.statusCode
=> 200

JSON.stringify({ answered: (await readFile(join(boxRoot, question), "utf8")).includes("Keep both versions"), phase: (await boxMaintenanceStatus(boxRoot)).phase, agents: invocations, jobs: (await readdir(getBoxDir(boxRoot, "jobs"))).filter((file) => file.includes("question-followup")).length })
=> {"answered":true,"phase":"exclusive","agents":1,"jobs":0}

const denied = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: "_bookkeeping/questions/Ordinary.question.card", answer: "yes" } });
denied.statusCode
=> 503

const owner = await acquireBoxMaintenance(boxRoot, { reason: "retry", recover: true });
await owner.run(() => repairMigration({ ...repairOptions, retry: async () => 0 }));
agentPrompt.includes("Previous answered question") && agentPrompt.includes("Keep both versions")
=> true

await owner.release();
const cliQuestion = question.replace("-0.question.card", "-1.question.card");
await writeFile(join(boxRoot, cliQuestion), createTextQuestionTemplate({ memo: "Migration attachments", askedAt: "2026-09-14T00:00:00Z", prompt: `Migration: attachments\nRecovery: ${snapshot.ref}`, directive: "Wait for migration repair" }));
await exec(process.execPath, ["--import", import.meta.resolve("tsx"), join(PACKAGE_ROOT, "src/cli/index.ts"), "answer", cliQuestion, "Use the preserved copy"], { cwd: boxRoot });
(await readFile(join(boxRoot, cliQuestion), "utf8")).includes("Use the preserved copy")
=> true

// Already-applied partial questions need their ordinary follow-up, after reopen.
await writeFile(join(boxRoot, "_config/migrations.jsonl"), JSON.stringify({ name: "attachments", "applied-at": "2026-09-14T00:00:00Z" }) + "\n");
const applied = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", payload: { questionPath: cliQuestion, answer: "must wait" } });
JSON.stringify({ status: applied.statusCode, waitsForReopen: applied.payload.includes("already applied") })
=> {"status":400,"waitsForReopen":true}

const open = await acquireBoxMaintenance(boxRoot, { reason: "done", recover: true });
await open.complete();
const ordinary = "_bookkeeping/questions/Ordinary.question.card";
await writeFile(join(boxRoot, ordinary), createTextQuestionTemplate({ memo: "Question", askedAt: "2026-09-14T00:00:00Z", prompt: "Proceed?", directive: "Process answer" }));
const accepted = await acquireBoxWork(boxRoot, { reason: "test" });
const drain = await closeBoxMaintenance(boxRoot, { reason: "drain accepted answer" });
const normal = await ctx.server.inject({ method: "POST", url: "/test/api/trpc/actions.answer", headers: { "x-bbx-box-work": accepted.run(boxWorkEnvironment).BBX_BOX_WORK }, payload: { questionPath: ordinary, answer: "yes" } });
normal.statusCode
=> 200

(await readdir(getBoxDir(boxRoot, "jobs"))).filter((file) => file.includes("question-followup")).length
=> 1

await accepted.release();
await drain.drain();
await drain.complete();
```

```ts cleanup
await ctx.cleanup();
```

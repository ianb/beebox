# Migration deadlines begin after admission drains

Cancellation waits for subprocess termination, leaves changed maintenance closed,
and preserves pending manifests and Git recovery references.

```ts setup
import { z } from "zod";
import { createClaudeAgent } from "../../src/core/agent/index.js";
import { createCodexAgent } from "../../src/core/agent/codex-agent.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { runMigrationProcess } from "../../src/core/migration-process.js";
import { boxMaintenanceStatus, acquireBoxWork } from "../../src/lib/box-maintenance.js";
const PROBE = "annex-config-2026-08";
async function preparedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((m) => m.name !== PROBE).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00Z" })).join("\n") + "\n");
  await box.commitAll("seed");
  return box;
}
const waitForAbort = (signal) => signal.aborted ? Promise.resolve() : new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
function refs(box, prefix) {
  return execFileSync("git", ["for-each-ref", "--format=%(refname)", prefix], { cwd: box.root, encoding: "utf8" }).trim();
}
```

## Script descendants cannot continue after expiry

```ts
const box = await preparedBox();
const pidFile = join(box.root, "child.pid");
const childCode = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
const script = `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
const runScript = ({ signal }) => runMigrationProcess({ file: process.execPath, args: ["-e", script], cwd: box.root, env: process.env, signal });
await sweepMigrations({ boxRoot: box.root, executionMs: 2000, runScript })
=> throws MigrationExecutionTimeoutError

const pid = Number(await readFile(pidFile, "utf8"));
JSON.stringify({ childAlive: alive(pid), phase: (await boxMaintenanceStatus(box.root)).phase, recorded: (await box.read(MANIFEST_PATH)).includes(PROBE), snapshot: refs(box, `refs/bbx/migrations/${PROBE}/snapshots/`).length > 0 })
=> {"childAlive":false,"phase":"exclusive","recorded":false,"snapshot":true}
```

```ts cleanup
await box.cleanup();
```

## Repair cancellation leaves its receipt and does not retry

```ts
const box = await preparedBox();
let runs = 0;
let invoked = 0;
const repairAgent = { invokeStructured: async (_schema, options) => {
  invoked += 1;
  await waitForAbort(options.signal);
  return { success: false, sessionId: "cancelled-repair", error: "cancelled", exitCode: 1 };
} };
await sweepMigrations({ boxRoot: box.root, repair: true, executionMs: 2000,
  runScript: async () => { runs += 1; return 1; }, repairAgent })
=> throws MigrationExecutionTimeoutError

JSON.stringify({ runs, invoked, phase: (await boxMaintenanceStatus(box.root)).phase, receipt: refs(box, `refs/bbx/migrations/${PROBE}/repair-started`).length > 0 })
=> {"runs":1,"invoked":1,"phase":"exclusive","receipt":true}
```

```ts cleanup
await box.cleanup();
```

## Draining does not consume the execution budget

```ts
const box = await preparedBox();
const active = await acquireBoxWork(box.root, { reason: "test" });
let settled = false;
const attempt = sweepMigrations({ boxRoot: box.root, executionMs: 50,
  runScript: async ({ signal }) => { await waitForAbort(signal); signal.throwIfAborted(); return 0; },
}).then(() => { settled = true; }, (error) => { settled = true; return error.name; });
await new Promise((resolve) => setTimeout(resolve, 150));
settled
=> false

await active.release();
await attempt
=> MigrationExecutionTimeoutError
```

```ts cleanup
await active.release();
await box.cleanup();
```

## Both configured harnesses reject cancellation before loading or launching

```ts
const signal = AbortSignal.abort();
const options = { boxRoot: "/nonexistent-test-box", prompt: "cancelled", signal };
const agents = [createClaudeAgent, createCodexAgent].map((create) => create({ name: "cancelled" }));
const failures = await Promise.all(agents.flatMap((agent) => [
  agent.invoke(options).catch((error) => error.name),
  agent.invokeStructured(z.object({}), options).catch((error) => error.name),
]));
JSON.stringify(failures)
=> ["AbortError","AbortError","AbortError","AbortError"]
```

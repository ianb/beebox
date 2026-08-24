# Detached automatic workstream sweep

Session hooks submit the global sweep outside their process group. The worker
serializes whole sweeps and records terminal status in the lifecycle log.

```ts setup
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "auto-sweep-doctest-"));
const fixtureRepo = path.join(root, "repo");
const hookDir = path.join(fixtureRepo, ".claude/hooks");
const binDir = path.join(root, "bin");
const home = path.join(root, "home");
const record = path.join(root, "launchctl-record");
const started = path.join(root, "sweep-started");
const release = path.join(root, "release");
const waitEnabled = path.join(root, "wait-enabled");
const calls = path.join(root, "sweep-calls");
const removeRecord = path.join(root, "launchctl-remove-record");
await fs.mkdir(hookDir, { recursive: true });
await fs.mkdir(path.join(fixtureRepo, "bin"));
await fs.mkdir(binDir);
await fs.mkdir(home);
await fs.copyFile(path.join(repoRoot, ".claude/hooks/auto-sweep.sh"), path.join(hookDir, "auto-sweep.sh"));
await fs.chmod(path.join(hookDir, "auto-sweep.sh"), 0o755);

await fs.writeFile(path.join(binDir, "launchctl"), [
  "#!/usr/bin/env node",
  'const { spawn } = require("node:child_process");',
  'const fs = require("node:fs");',
  "const args = process.argv.slice(2);",
  'if (args[0] === "remove") { fs.appendFileSync(process.env.REMOVE_RECORD, `${args[1]}\\n`); process.exit(0); }',
  'fs.writeFileSync(process.env.SUBMIT_RECORD, `${args.join(" ")}\\n`);',
  'const split = args.indexOf("--");',
  'const command = args.slice(split + 1);',
  'spawn(command[0], command.slice(1), { detached: true, stdio: "ignore", env: process.env }).unref();',
].join("\n"));
await fs.chmod(path.join(binDir, "launchctl"), 0o755);
await fs.writeFile(path.join(fixtureRepo, "bin/workstreams"), [
  "#!/bin/sh",
  `if [ -f "${waitEnabled}" ]; then`,
  `  : > "${started}"`,
  `  while [ ! -f "${release}" ]; do sleep 0.01; done`,
  "fi",
  `echo run >> "${calls}"`,
  'echo "sweep ran"',
  'exit "${SWEEP_STATUS:-0}"',
].join("\n"));
await fs.chmod(path.join(fixtureRepo, "bin/workstreams"), 0o755);

const script = path.join(hookDir, "auto-sweep.sh");
const baseEnv = {
  ...process.env,
  HOME: home,
  PATH: `${binDir}:${process.env.PATH ?? ""}`,
  SUBMIT_RECORD: record,
  REMOVE_RECORD: removeRecord,
};
interface ProcessResult { code: number | null; stderr: string }
function runProcess(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(script, args, {
    env: { ...baseEnv, ...extraEnv },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<ProcessResult>((resolveDone) => {
    child.on("exit", (code) => resolveDone({ code, stderr }));
  });
  return { child, done };
}
const request = path.join(home, ".cache/callback-box/auto-sweep.requested");
async function worker(trigger: string, extraEnv: NodeJS.ProcessEnv = {}) {
  await fs.mkdir(path.dirname(request), { recursive: true });
  await fs.writeFile(request, `${trigger}\n`);
  return runProcess(["--run-detached", "", trigger], extraEnv);
}
async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}
async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await exists(file))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${file}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null) {
    assert.ok(Date.now() < deadline, "timed out waiting for trigger exit");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
async function waitForLog(text: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const content = await fs.readFile(lifecycleLog, "utf8").catch(() => "");
    if (content.includes(text)) return;
    assert.ok(Date.now() < deadline, `timed out waiting for log: ${text}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
const lifecycleLog = path.join(home, ".cache/callback-box/worktree-cleanup.log");
```

## Trigger submits without running sweep inline

The fake launchctl starts the submitted worker in a detached process group. The
worker blocks inside fake workstreams; trigger mode must exit while it remains
blocked, then the worker completes and removes its submitted label.

```ts
await fs.writeFile(waitEnabled, "wait\n");
const trigger = runProcess(["session-end"]);
await waitFor(started);
await waitForExit(trigger.child);
const triggerResult = await trigger.done;
const submission = await fs.readFile(record, "utf8");
const blockedAfterTriggerExit = !(await exists(release));
await fs.writeFile(release, "release\n");
await waitForLog("trigger=session-end END status=0");
await waitFor(removeRecord);
JSON.stringify({
  code: triggerResult.code,
  submittedWorker: submission.includes("--run-detached") && submission.includes("session-end"),
  blockedAfterTriggerExit,
  removedLabel: (await fs.readFile(removeRecord, "utf8")).includes("com.callback-box.auto-sweep."),
})
=> {"code":0,"submittedWorker":true,"blockedAfterTriggerExit":true,"removedLabel":true}
```

## Worker lock prevents overlapping sweeps

The first worker reaches an operation-owned barrier inside sweep. Two newer
requests queue behind it; one consumes their shared request marker and runs,
while the other coalesces without dropping the trailing request.

```ts continue
await fs.rm(release, { force: true });
await fs.rm(started, { force: true });
await fs.writeFile(calls, "");
const first = await worker("first");
await waitFor(started);
const second = await worker("second");
const third = await worker("third");
await fs.writeFile(release, "release\n");
const [firstResult, secondResult, thirdResult] = await Promise.all([first.done, second.done, third.done]);
const log = await fs.readFile(lifecycleLog, "utf8");
const runCount = (await fs.readFile(calls, "utf8")).trim().split("\n").length;
JSON.stringify({
  first: firstResult.code,
  queued: [secondResult.code, thirdResult.code],
  runCount,
  ended: log.includes("trigger=first END status=0"),
  coalesced: log.includes("COALESCED no-request"),
})
=> {"first":0,"queued":[0,0],"runCount":2,"ended":true,"coalesced":true}
```

## Worker failures are terminal and visible

```ts continue
await fs.rm(waitEnabled, { force: true });
const failed = await (await worker("failure", { SWEEP_STATUS: "7" })).done;
const failureLog = await fs.readFile(lifecycleLog, "utf8");
JSON.stringify({ code: failed.code, visible: failureLog.includes("trigger=failure END status=7") })
=> {"code":7,"visible":true}
```

## Lock-tool failure is not mislabeled as contention

```ts continue
const fakeLockf = path.join(binDir, "lockf");
await fs.writeFile(fakeLockf, "#!/bin/sh\nexit 64\n");
await fs.chmod(fakeLockf, 0o755);
const lockFailure = await (await worker("lock-failure")).done;
const lockFailureLog = await fs.readFile(lifecycleLog, "utf8");
await fs.rm(fakeLockf);
JSON.stringify({ code: lockFailure.code, visible: lockFailureLog.includes("trigger=lock-failure LOCK-FAILED status=64") })
=> {"code":64,"visible":true}
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true });
```

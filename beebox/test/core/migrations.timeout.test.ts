// # Migration deadlines begin after admission drains
//
// Cancellation waits for subprocess termination, leaves changed maintenance closed,
// and preserves pending manifests and Git recovery references.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { z } from "zod";
import { createClaudeAgent } from "../../src/core/agent/invoke/core.js";
import { createCodexAgent } from "../../src/core/agent/codex-agent.js";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import type { Agent, AgentInvokeOptions, StructuredAgentResult } from "../../src/core/agent/invoke/core.js";
import { errnoCode } from "../../src/shared/error-guards.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { NOOP_MIGRATION, registerNoopMigration } from "./noop-migration.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { runMigrationProcess } from "../../src/core/migration-process.js";
import { boxMaintenanceStatus, acquireBoxWork } from "../../src/lib/box-maintenance/admission.js";

registerNoopMigration();
const PROBE = NOOP_MIGRATION;
async function preparedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(MANIFEST_PATH, MIGRATIONS.filter((m) => m.name !== PROBE).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00Z" })).join("\n") + "\n");
  await box.commitAll("seed");
  return box;
}
// Sections that need cancellation to land mid-script or mid-repair abort the
// sweep's own `signal` at that point. A short `executionMs` budget cannot
// promise it: the budget also covers snapshot and git setup, which under host
// load can outlast it before the script starts. The budget timer aborts the
// same signal, and "Draining does not consume the execution budget" below
// covers the timer itself.
// An Error whose `name` is what the expectations match on.
const expired = () => Object.assign(new Error("execution budget expired"), { name: "Expired" });
async function waitForFile(file: string) {
  while (true) {
    try { await access(file); return; }
    catch (_error) { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
}
const waitForAbort = (signal: AbortSignal) => signal.aborted ? Promise.resolve() : new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
async function stopped(pid: number) {
  const deadline = Date.now() + 2000;
  while (true) {
    try { process.kill(pid, 0); }
    catch (error) { if (errnoCode(error) === "ESRCH") return true; throw error; }
    // `ps -p` exits 1 when the pid is gone, and the process can exit between
    // the kill(0) above and this call; that is the stopped outcome too.
    const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    if (ps.status === 1) return true;
    if (ps.status !== 0) throw new Error(`ps failed (${String(ps.status)}): ${ps.stderr}`);
    const state = ps.stdout.trim();
    // A zombie has exited and cannot continue executing; init may reap it
    // shortly after the process-group SIGKILL reaches it.
    if (!state || state.startsWith("Z")) return true;
    if (Date.now() >= deadline) {
      console.error(`Migration test child ${String(pid)} remained in process state ${state} after SIGKILL`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function refs(box: TmpBox, prefix: string) {
  return execFileSync("git", ["for-each-ref", "--format=%(refname)", prefix], { cwd: box.root, encoding: "utf8" }).trim();
}

// ## Script descendants cannot continue after expiry
void test("Script descendants cannot continue after expiry", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await preparedBox();
  const pidFile = join(box.root, "child.pid");
  const childCode = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const script = `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const expiry = new AbortController();
  const runScript = ({ signal }: { signal?: AbortSignal | undefined }) => {
    // Expire once the descendant exists, so it is there to be stopped.
    void waitForFile(pidFile).then(() => expiry.abort(expired()));
    return runMigrationProcess({ file: process.execPath, args: ["-e", script], cwd: box.root, env: process.env, signal });
  };
  await t.checkThrows(async () => (await sweepMigrations({ boxRoot: box.root, signal: expiry.signal, runScript })), "Expired");

  const pid = Number(await readFile(pidFile, "utf8"));
  t.check({ childAlive: !(await stopped(pid)), phase: (await boxMaintenanceStatus(box.root))?.phase, recorded: (await box.read(MANIFEST_PATH)).includes(PROBE), snapshot: refs(box, `refs/bbx/migrations/${PROBE}/snapshots/`).length > 0 }, {
    childAlive: false,
    phase: "exclusive",
    recorded: false,
    snapshot: true,
  });
});

// ## Repair cancellation leaves its receipt and does not retry
void test("Repair cancellation leaves its receipt and does not retry", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await preparedBox();
  let runs = 0;
  let invoked = 0;
  const expiry = new AbortController();
  const repairAgent: Agent = {
    name: "repair",
    sessionId: null,
    invoke: async () => { throw new Error("the repair uses structured output"); },
    invokeStructured: async <T>(_schema: z.ZodType<T>, options: AgentInvokeOptions): Promise<StructuredAgentResult<T>> => {
      invoked += 1;
      // Expire while the repair is running.
      expiry.abort(expired());
      assert.ok(options.signal);
      await waitForAbort(options.signal);
      return { success: false, data: null, sessionId: "cancelled-repair", error: "cancelled", output: "", exitCode: 1 };
    },
  };
  await t.checkThrows(
    async () => (await sweepMigrations({ boxRoot: box.root, repair: true, signal: expiry.signal,
      runScript: async () => { runs += 1; return 1; }, repairAgent })),
    "Expired",
  );

  t.check({ runs, invoked, phase: (await boxMaintenanceStatus(box.root))?.phase, receipt: refs(box, `refs/bbx/migrations/${PROBE}/repair-started`).length > 0 }, {
    runs: 1,
    invoked: 1,
    phase: "exclusive",
    receipt: true,
  });
});

// ## Draining does not consume the execution budget
void test("Draining does not consume the execution budget", async (t) => {
  t.teardown(async () => {
    try {
      await active.release();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await preparedBox();
  const active = await acquireBoxWork(box.root, { reason: "test" });
  let settled = false;
  const attempt = sweepMigrations({ boxRoot: box.root, executionMs: 50,
    runScript: async ({ signal }) => { assert.ok(signal); await waitForAbort(signal); signal.throwIfAborted(); return 0; },
  }).then(() => { settled = true; }, (error) => { settled = true; return error instanceof Error ? error.name : String(error); });
  await new Promise((resolve) => setTimeout(resolve, 150));
  t.check(settled, false);

  await active.release();
  t.check(await attempt, "MigrationExecutionTimeoutError");
});

// ## Both configured harnesses reject cancellation before loading or launching
void test("Both configured harnesses reject cancellation before loading or launching", async (t) => {
  const signal = AbortSignal.abort();
  const options = { boxRoot: "/nonexistent-test-box", prompt: "cancelled", signal };
  const agents = [createClaudeAgent, createCodexAgent].map((create) => create({ name: "cancelled" }));
  const failures = await Promise.all(agents.flatMap((agent) => [
    agent.invoke(options).catch((error) => error.name),
    agent.invokeStructured(z.object({}), options).catch((error) => error.name),
  ]));
  t.check(failures, [
    "AbortError",
    "AbortError",
    "AbortError",
    "AbortError",
  ]);
});

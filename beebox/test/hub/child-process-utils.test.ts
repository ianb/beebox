// # Process helpers: `pidAlive` and `killGroup`
//
// The hub, the schedule runner, and several `bin/` tools use these to decide
// whether a recorded pid still runs and to stop a detached child with its
// whole process group. See `src/hub/child-process-utils.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { spawn } from "node:child_process";
import { killGroup, pidAlive } from "../../src/hub/child-process-utils.js";

// ## `pidAlive`
//
// This process is alive. A child that has exited and been reaped is not.
void test("pidAlive is true for this process and false for a reaped child", async (t) => {
  t.check(pidAlive(process.pid), true);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid ?? process.pid;
  await new Promise((resolve) => child.once("exit", resolve));
  t.check(pidAlive(pid), false);
});

// ## `killGroup`
//
// A missing pid and pid 0 do nothing (pid 0 would mean the caller's own group).
// A detached child is stopped through its process group.
void test("killGroup ignores no pid and pid 0, and stops a detached child", async (t) => {
  killGroup(undefined);
  killGroup(0);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  t.teardown(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
  killGroup(child.pid);
  await t.check(exited, "SIGTERM");
  await eventually(() => (child.pid !== undefined && pidAlive(child.pid) ? null : true), { label: "the child pid to disappear" });
});

// Unit tests for the doctor's two deploy-target-dependent checks: is main's
// HEAD live on the server, and is that server running out of disk. Both hang
// off the opt-in `beebox/deploy/target.env` (via deploy-target.sh), so both
// have to skip cleanly on a machine that doesn't deploy — which, since the
// commit hooks went silent, is where the "main is undeployed" signal now
// lives. Split from doctor.test.ts, which is at its line budget. Run with:
//   node --import tsx --test bin/doctor-deploy.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDeployCurrency, checkProductionDisk } from "./doctor-checks.js";
import type { CommandResult, RunCommand } from "./doctor-lib.js";

const GIT_COMMON = "git rev-parse --path-format=absolute --git-common-dir";

function ok(stdout: string): CommandResult {
  return { spawned: true, code: 0, stdout, stderr: "" };
}

/** Dispatch on the whole command line, so a test states exactly what it fakes. */
function fakeRun(responses: Record<string, CommandResult>): RunCommand {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    return responses[key] ?? { spawned: false, code: null, stdout: "", stderr: "" };
  };
}

const DEPLOY_TARGET_SCRIPT = "/checkouts/beebox/beebox/deploy/deploy-target.sh ssh-target";

test("checkProductionDisk reports free space and fails below the shared threshold", async () => {
  const base = {
    [GIT_COMMON]: ok("/checkouts/beebox/.git\n"),
    [DEPLOY_TARGET_SCRIPT]: ok("root@203.0.113.10\n"),
  };
  const check = async (availableKib: number) => checkProductionDisk({
    run: fakeRun({
      ...base,
      "ssh -o BatchMode=yes -o ConnectTimeout=5 root@203.0.113.10 df -Pk /": ok(`Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 78643200 0 ${String(availableKib)} 0% /\n`),
    }),
  });

  const healthy = await check(65 * 1024 * 1024);
  assert.equal(healthy.ok, true);
  assert.match(healthy.detail, /65\.0 GiB free.*7\.5 GiB/);
  const low = await check(5 * 1024 * 1024);
  assert.equal(low.ok, false);
  assert.match(low.detail, /5\.0 GiB free.*7\.5 GiB/);
});

test("checkProductionDisk skips a machine with no configured deploy target", async () => {
  const result = await checkProductionDisk({
    run: fakeRun({
      [GIT_COMMON]: ok("/checkouts/beebox/.git\n"),
      [DEPLOY_TARGET_SCRIPT]: { spawned: true, code: 1, stdout: "", stderr: "" },
    }),
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /does not deploy/);
});

test("checkDeployCurrency flags main ahead of the last completed deploy", async () => {
  const result = await checkDeployCurrency({
    run: fakeRun({
      [GIT_COMMON]: ok("/checkouts/beebox/.git\n"),
      [DEPLOY_TARGET_SCRIPT]: ok("root@203.0.113.10\n"),
      "cat /checkouts/beebox/beebox/deploy/.last-deployed-sha": ok(`${"a".repeat(40)}\n`),
      "git rev-parse main": ok(`${"b".repeat(40)}\n`),
      [`git rev-list --count ${"a".repeat(40)}..main`]: ok("3\n"),
    }),
    fileExists: () => true,
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /3 commit\(s\) ahead/);
});

test("checkDeployCurrency skips a machine with no configured deploy target", async () => {
  const result = await checkDeployCurrency({
    run: fakeRun({
      [GIT_COMMON]: ok("/checkouts/beebox/.git\n"),
      [DEPLOY_TARGET_SCRIPT]: { spawned: true, code: 1, stdout: "", stderr: "" },
    }),
    fileExists: () => true,
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /does not deploy/);
});

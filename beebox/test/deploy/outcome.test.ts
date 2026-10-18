// # How a deploy run ended
//
// `deploy.sh` tells the boxholder whether a deploy succeeded, failed, or was
// interrupted, and records the same outcome in `deploy/.deploy-logs/deploys.jsonl`.
// An interrupt is known only from the signal trap. An exit code of 128 or more
// is not evidence of a signal: `ssh` exits 255 when it cannot reach the server,
// and that was once reported as "interrupted, not a failure", which also
// skipped the queued deploy
// (`issues/bugs/2026-09-18-deploy-reads-ssh-failure-as-a-signal.md`).

import { test } from "tap";
import "agent-doctest/tap";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
async function outcome(rc: number, signal: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", ["-c", '. deploy/deploy-outcome.sh; deploy_outcome "$1" "$2"', "bash", String(rc), signal]);
  return stdout.trim();
}

void test("line 23", async (t) => {
  // doctest:L24
  t.check([await outcome(0, ""), await outcome(1, ""), await outcome(137, "")].join(" "), "ok failed failed");

  // doctest:L27
  t.check(await outcome(255, ""), "unreachable");

  // doctest:L30
  t.check(await outcome(130, "INT"), "interrupted");
});

// `deploy.sh` classifies through that function and chains a queued deploy after
// every outcome except an interrupt.
void test("deploy.sh classifies through that function and chains a queued deploy after e...", async (t) => {
  // doctest:L38
  const deploySh = await readFile("deploy/deploy.sh", "utf8");
  await t.checkText(deploySh.includes('"$rc" -ge 128'), "false");

  // doctest:L42
  await t.checkText(deploySh.includes('outcome="$(deploy_outcome "$rc" "$INTERRUPTED_BY")"'), "true");

  // doctest:L45
  await t.checkText(deploySh.includes('if [ "$outcome" != interrupted ] && [ -n "$newer" ]'), "true");
});

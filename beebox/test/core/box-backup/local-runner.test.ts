// The local runner catches up immediately and stops cleanly with its server.

import { test } from "tap";
import { localBackupCommandActive, localBackupRunnerActive, startLocalBackupRunner } from "../../../src/core/box-backup/local-runner.js";

void test("local backup runner starts a catch-up pass and aborts it on stop", async (t) => {
  const started: string[] = [];
  let aborted = false;
  const runner = startLocalBackupRunner({
    boxRoots: ["/box/one"],
    intervalMs: 60_000,
    runScheduled: async (boxRoot, signal) => {
      started.push(boxRoot);
      await new Promise<void>((resolve) => {
        if (signal.aborted) { aborted = true; resolve(); return; }
        signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
      });
    },
  });
  t.teardown(async () => { await runner?.stop(); });

  for (let i = 0; i < 100 && started.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  t.check(started, ["/box/one"]);
  t.check(localBackupRunnerActive(), true);
  t.check(localBackupCommandActive(), true);

  await runner?.stop();
  t.check(aborted, true);
  t.check(localBackupRunnerActive(), false);
  t.check(localBackupCommandActive(), false);
});

void test("an empty server does not register a local backup runner", async (t) => {
  await t.check(startLocalBackupRunner({ boxRoots: [] }), null);
  await t.check(localBackupRunnerActive(), false);
});

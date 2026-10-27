// # Starting the job check's run, and logging its end
//
// Nothing waits for a job-check run, so its end is the only record of how it
// went. `logRunEnd` writes one `job-check` line with action `run ended` to the
// box's `scheduler.jsonl`: `ok`, the outcome's counts, and the detail of a
// failed run, or the error of a rejected one. See
// docs/implemented-plans/on-demand-job-triggers.md, Track C.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { isoDate } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { jobCheckStarter, logRunEnd } from "../../../../src/core/schedule/job-check/start.js";
import { registerBoxPublicUrl, unregisterBoxPublicUrl } from "../../../../src/core/script-env/core.js";
import type { WakeupRunner } from "../../../../src/core/wakeup-runner.js";
import { makeTestServer, TEST_SLUG } from "../../../helpers/test-route-server.js";
import { boxLogFile } from "../../../../src/core/schedule/box-log.js";

void test("A failed run and a rejected one each leave a line", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());

  await logRunEnd(box.root, Promise.resolve({ ok: false, detail: "bbx wakeup exited with code 1", output: "", outcome: null }));
  await logRunEnd(box.root, Promise.reject(new Error("spawn EACCES")));
  const lines: unknown[] = (await readFile(boxLogFile(box.root), "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
  t.check(lines, [
    { ts: isoDate(), event: "job-check", action: "run ended", box: box.root, ok: false, jobsProcessed: null, jobsRemaining: null, detail: "bbx wakeup exited with code 1" },
    { ts: isoDate(), event: "job-check", action: "run ended", box: box.root, ok: false, error: "spawn EACCES" },
  ]);
});

// ## On a unit host the pass asks the box server
//
// The pass unit's children end with it, so on a unit host `jobCheckStarter`
// asks the box server (`wakeup.start`) with the box's own agent token and
// returns the server's answer. The server here runs a substituted child that
// takes the lock at once.
void test("On a unit host the pass asks the box server", async (t) => {
  const calls: unknown[] = [];
  const wakeupRunner: WakeupRunner = async (opts) => {
    calls.push({ triggeredBy: opts.triggeredBy, maxCycles: opts.maxCycles });
    await Promise.resolve();
    opts.onChunk?.("[wakeup-cycle] acquired\n");
    return { ok: true, detail: "", output: "", outcome: null };
  };
  const server = await makeTestServer({ openAccess: false, services: { wakeupRunner } });
  const url = await server.server.listen({ port: 0, host: "127.0.0.1" });
  const savedUnit = process.env.BBX_UNIT_HOST;
  process.env.BBX_UNIT_HOST = "1";
  registerBoxPublicUrl(server.boxRoot, `${url}/${TEST_SLUG}`);
  t.teardown(async () => {
    unregisterBoxPublicUrl(server.boxRoot);
    if (savedUnit === undefined) delete process.env.BBX_UNIT_HOST;
    else process.env.BBX_UNIT_HOST = savedUnit;
    await server.cleanup();
  });

  t.check({ answer: await jobCheckStarter()(server.boxRoot), calls }, {
    answer: { state: "started", detail: "" },
    calls: [{ triggeredBy: "job-check", maxCycles: 3 }],
  });
});

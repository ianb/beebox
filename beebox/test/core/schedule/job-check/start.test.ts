// # The job check's run: its end is logged, success or not
//
// Nothing waits for a job-check run, so its end is the only record of how it
// went. `logRunEnd` writes one `job-check` line with action `run ended` to the
// box's `scheduler.jsonl`: `ok`, the outcome's counts, and the detail of a
// failed run, or the error of a rejected one. See
// docs/plans/on-demand-job-triggers.md, Track C.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { isoDate } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { logRunEnd } from "../../../../src/core/schedule/job-check/start.js";
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

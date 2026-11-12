// # The scheduler pass keeps the job check apart
//
// `runSchedulerPass` (`src/core/schedule/scheduler/pass.ts`) runs the job
// check after the tick and before the box alerts, in its own `try`: a check
// that throws is one `job-check` line in the box's `scheduler.jsonl`, and the
// tick's line and the rest of the pass are unaffected. See
// docs/implemented-plans/on-demand-job-triggers.md, Track B.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { runSchedulerPass } from "../../../../src/core/schedule/scheduler/pass.js";
import { boxLogFile } from "../../../../src/core/schedule/box-log.js";
import { isRecord } from "../../../../src/shared/is-record.js";

void test("A job check that throws does not stop the pass", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const seen: string[] = [];

  const outcome = await runSchedulerPass(box.root, {
    jobCheck: (boxRoot) => {
      seen.push(boxRoot);
      return Promise.reject(new Error("jobs directory unreadable"));
    },
  });
  const events = (await readFile(boxLogFile(box.root), "utf-8")).trim().split("\n").map((line): unknown => {
    const entry: unknown = JSON.parse(line);
    return isRecord(entry) ? [entry.event, entry.error ?? null] : entry;
  });
  t.check({ outcome, seen, events }, {
    outcome: "ran",
    seen: [box.root],
    events: [
      ["tick", null],
      ["job-check", "jobs directory unreadable"],
    ],
  });
});

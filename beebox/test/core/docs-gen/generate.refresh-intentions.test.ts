// # `refresh-intentions` reaches existing boxes
//
// No migration installs the procedure and its schedule: `generateDocs` re-runs
// the template sync (`installProcedures`, `installSchedules`) whenever the
// engine version changes, which is how `question-review` reached existing
// boxes. This box was made without either card, as a box from before this
// engine version would be.

import { readFile } from "node:fs/promises";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { generateDocs } from "../../../src/core/docs-gen/generate/core.js";
import { parseFrontmatterObject } from "../../../src/exports/cards.js";
import { fileExists } from "../../../src/lib/file-exists.js";
import { getStatus } from "../../../src/lib/git/core/operations.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const PROCEDURE = "_config/procedures/refresh-intentions.procedure.card";
const SCHEDULE = "_config/schedules/refresh-intentions.scheduled-script.card";

void test("the template sync installs the procedure and its schedule into an existing box", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  t.check({ procedure: await fileExists(box.path(PROCEDURE)), schedule: await fileExists(box.path(SCHEDULE)) }, { procedure: false, schedule: false });

  await generateDocs(box.root, { force: true });

  // The stock procedure is installed as shipped.
  t.check(await box.read(PROCEDURE), await readFile(new URL("../../../templates/procedures/refresh-intentions.procedure.card", import.meta.url), "utf-8"));
  t.check(parseFrontmatterObject(await box.read(SCHEDULE)), {
    cron: "15 6 * * *",
    "not-before": "20h",
    timeout: "30m",
    runs: "bbx procedure run refresh-intentions",
    description: any(String),
    reason: "Daily early-morning pass; precheck no-ops when no place has changed since its last review",
  });
  // Both are committed by the sync, not left in the working tree.
  const status = await getStatus(box.root);
  t.check([...status.staged, ...status.modified, ...status.untracked].filter((p) => p.includes("refresh-intentions")), []);
});

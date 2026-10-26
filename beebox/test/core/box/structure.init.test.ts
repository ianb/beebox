// # Box Init Command
//
// Tests that `bbx init` creates the full box structure and commits everything in one initial commit — including schedules, procedures, guides, and personality cards.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installProcedures, installGuides, installSchedules, installPersonality } from "../../../src/core/box/structure/core.js";
import { scaffoldBoxRoot } from "../../../src/core/box/package.js";
import { stageAll, commit, getLog, getStatus, isRepo, initRepo } from "../../../src/lib/git/core/operations.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-init-test-"));
}

// Simulate what `bbx init` does on a fresh path: scaffold the box (npm-package
// half + operational half, both at the one root), run the card installers,
// then git init + single commit at that same root.
async function fullInit(target: string) {
  const { boxRoot } = await scaffoldBoxRoot(target);
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);
  await initRepo(boxRoot, "main");
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: "Initialize Bee Box",
    trailers: { "Created-By": "bbx init" },
  });
  return { boxRoot };
}

async function listFiles(root: string, subdir: string) {
  const dir = path.join(root, subdir);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(e => !e.startsWith(".")).toSorted().join("\n");
  } catch (_e) {
    return "(not found)";
  }
}

// ## Full init includes schedules in the commit
//
// After a fresh init, schedule files should be committed (not just on disk):
void test("After a fresh init, schedule files should be committed (not just on disk):", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  await t.checkText(await listFiles(boxRoot, "_config/schedules"), `chat-review.scheduled-script.card
check-calendar.scheduled-script.card
check-drive.scheduled-script.card
check-email.scheduled-script.card
gc-procedure-runs.scheduled-script.card
process-retrospective.scheduled-script.card
question-review.scheduled-script.card
refresh-maps.scheduled-script.card
todo-review.scheduled-script.card`);

  // The working tree is clean — everything is committed, nothing left untracked:
  t.check(await getStatus(boxRoot), { staged: [], modified: [], untracked: [], clean: true });

  // There's exactly one commit with the right subject:
  t.check(await getLog(boxRoot, 5), [
    {
      hash: any(String).matches(/^[\da-f]{40}$/),
      date: isoDate(),
      subject: "Initialize Bee Box",
      body: "Created-By: bbx init",
      trailers: { "Created-By": "bbx init" },
    },
  ]);
});

// ## Procedures and guides are also committed
void test("Procedures and guides are also committed", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  await t.checkText(await listFiles(boxRoot, "_config/procedures"), `browser-task-drain.procedure.card
process-retrospective.procedure.card
question-review.procedure.card
refresh-maps.procedure.card
todo-review.procedure.card`);

  // The stock agent-backed procedures use portable tiers, so a fresh box never
  // ships a provider-specific model pin:

  const refreshMaps = await fs.readFile(
    path.join(boxRoot, "_config/procedures/refresh-maps.procedure.card"),
    "utf8",
  );
  const browserTaskDrain = await fs.readFile(
    path.join(boxRoot, "_config/procedures/browser-task-drain.procedure.card"),
    "utf8",
  );
  const procedureDir = path.join(boxRoot, "_config/procedures");
  const stockProcedures = await Promise.all(
    (await fs.readdir(procedureDir))
      .filter((name) => name.endsWith(".procedure.card"))
      .map((name) => fs.readFile(path.join(procedureDir, name), "utf8")),
  );
  // Whole procedure files are large generated text; the narrow checks look for one line.
  t.check(refreshMaps, any(String).includes("model: balanced"));
  t.check(browserTaskDrain, any(String).includes("model: balanced"));
  t.check(stockProcedures.join("\n"), not(any(String).matches(/model: (?:haiku|sonnet|opus|fable)/)));

  await t.checkText(await listFiles(boxRoot, "_config"), `calendar.guide.card
connectors
feedback
intake.guide.card
interface
main.personality.card
migrations.jsonl
procedures
schedules
schemas
template-versions.json
transcription.json`);

  t.check(await getStatus(boxRoot), { staged: [], modified: [], untracked: [], clean: true });
});

// ## Git repo is initialized
void test("Git repo is initialized", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  t.check(await isRepo(boxRoot), true);
});

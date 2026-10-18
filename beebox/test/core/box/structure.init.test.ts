// # Box Init Command
//
// Tests that `bbx init` creates the full box structure and commits everything in one initial commit — including schedules, procedures, guides, and personality cards.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
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
  // doctest:L51
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  // doctest:L54
  await t.checkText(await listFiles(boxRoot, "_config/schedules"), `chat-review.scheduled-script.card
check-calendar.scheduled-script.card
check-drive.scheduled-script.card
check-email.scheduled-script.card
gc-procedure-runs.scheduled-script.card
process-retrospective.scheduled-script.card
refresh-maps.scheduled-script.card
todo-review.scheduled-script.card`);

  // The working tree is clean — everything is committed, nothing left untracked:

  // doctest:L69
  const status = await getStatus(boxRoot);
  t.check(status.clean, true);

  // There's exactly one commit with the right subject:

  // doctest:L77
  const log = await getLog(boxRoot, 5);
  await t.checkText(log.length, "1");

  // doctest:L81
  t.check(log[0]?.subject, "Initialize Bee Box");
});

// ## Procedures and guides are also committed
void test("Procedures and guides are also committed", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L92
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  // doctest:L95
  await t.checkText(out.with(await listFiles(boxRoot, "_config/procedures")), `browser-task-drain.procedure.card
process-retrospective.procedure.card
refresh-maps.procedure.card
todo-review.procedure.card`);

  // The stock agent-backed procedures use portable tiers, so a fresh box never
  // ships a provider-specific model pin:

  // doctest:L107
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
  print(`refresh-maps: ${refreshMaps.includes("model: balanced")}`);
  print(`browser-task-drain: ${browserTaskDrain.includes("model: balanced")}`);
  await t.checkText(out.with(print(`provider pins: ${/model: (?:haiku|sonnet|opus|fable)/.test(stockProcedures.join("\n"))}`)), `refresh-maps: true
browser-task-drain: true
provider pins: false`);

  // doctest:L131
  await t.checkText(out.with(await listFiles(boxRoot, "_config")), `calendar.guide.card
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

  // doctest:L148
  const status = await getStatus(boxRoot);
  await t.checkText(out.with(status.clean), "true");
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
  // doctest:L160
  const tmp = await makeTmpDir();
  const { boxRoot } = await fullInit(tmp);

  // doctest:L163
  t.check(await isRepo(boxRoot), true);
});

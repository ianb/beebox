// # health: parked template updates
//
// An upstream template change that can't be written (the box copy diverged) is
// parked in `_config/_template-updates/<path>`. Before this check, `bbx health`
// mentioned templates zero times, so a corrected procedure card could sit parked
// while the task that runs it failed identically, round after round
// (`issues/bugs/2026-08-24-parked-template-updates-are-invisible-in-health.md`).

import { test } from "tap";
import "agent-doctest/tap";
import { templateUpdatesCheck } from "../../../../../../src/webapp/trpc/routers/health/checks/templates.js";
import { loadScheduleHealth, summarizeScheduleHealth } from "../../../../../../src/core/schedule/health-box.js";
import { saveScriptState, normalizeScriptState } from "../../../../../../src/core/schedule/state.js";
import { makeTmpBox } from "../../../../../helpers/test-helpers.js";
import {
  parkedUpdatesForTask,
  procedureCardForRuns,
} from "../../../../../../src/core/schedule/parked-templates.js";

const NOW = new Date("2026-08-24T12:00:00Z");

const scheduleCard = (runs: string) =>
  `---\ncron: "0 5 * * *"\nruns: ${runs}\ndescription: Refresh the box's maps\n---\n`;

const procedureCard = "---\nsteps:\n  - name: refresh\n    instructions: Rebuild MAP.md\n---\n";

// ## Nothing parked
//
// The quiet case says so rather than staying silent — the check is enumerated in
// `bbx health`'s pass count either way.
void test("The quiet case says so rather than staying silent — the check is enumerated i...", async (t) => {
  t.teardown(async () => {
    try {
      await clean.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L33
  const clean = await makeTmpBox({ git: true });
  const ok = await templateUpdatesCheck(clean.root);
  t.check(ok, { name: "template-updates", ok: true, message: "No template updates parked for review", severity: "warning" });
});

// ## Parked updates with no failing task: `warning`, listing paths and the way out
//
// Drift is a pending choice, not a defect, so it must not fail a deploy. The
// message ends with the same resolution sentence `bbx status` prints — both read it
// from `PARKED_TEMPLATE_RESOLUTION`, so the instruction can't drift between them.
void test("Drift is a pending choice, not a defect, so it must not fail a deploy.", async (t) => {
  t.teardown(async () => {
    try {
      await drifted.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L50
  const drifted = await makeTmpBox({ git: true });
  await drifted.write("_config/_template-updates/_config/briefing.guide.card", "---\n---\nstock\n");
  await drifted.write("_config/_template-updates/_config/procedures/refresh-maps.procedure.card", procedureCard);
  const warn = await templateUpdatesCheck(drifted.root);
  t.check(warn, { name: "template-updates", ok: false, message: "2 template updates parked for review: _config/briefing.guide.card, _config/procedures/refresh-maps.procedure.card. Run bbx template diff <path>, then bbx template accept <path> or keep/merge the local file and run bbx template resolve <path>.", severity: "warning" });
});

// ## A parked update behind a failing task escalates to `error`
//
// The trap: the live procedure card carries the old text, the fix is parked, and
// the task that runs it fails on every occurrence. That is not drift — it is a
// known-broken task whose fix is already on disk, so the check names the task and
// raises severity.
void test("The trap:", async (t) => {
  t.teardown(async () => {
    try {
      await stuck.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L73
  const stuck = await makeTmpBox({ git: true });
  await stuck.write("_config/schedules/refresh-maps.scheduled-script.card", scheduleCard("bbx procedure run refresh-maps"));
  await stuck.write("_config/procedures/refresh-maps.procedure.card", procedureCard);
  await stuck.write("_config/_template-updates/_config/procedures/refresh-maps.procedure.card", procedureCard.replace("MAP.md", "MAP.md, skipping doubled path segments"));
  const state = normalizeScriptState({ lastRun: "2026-08-24T05:00:10Z", lastResult: "failure", consecutiveFailures: 5, lastError: "step refresh failed" });
  await saveScriptState({ boxRoot: stuck.root, scriptName: "refresh-maps", state });
  const health = await loadScheduleHealth(stuck.root, NOW);
  t.check(health.tasks.map((task) => ({ name: task.name, status: task.status, parked: task.parkedTemplateUpdates })), [
    {
      name: "refresh-maps",
      status: "failing",
      parked: [
        "_config/procedures/refresh-maps.procedure.card",
      ],
    },
  ]);

  // The task association is computed in `health-box.ts`, not in the CLI, so the
  // dashboard and `--json` carry it too. The check reads it:

  // doctest:L88
  const err = await templateUpdatesCheck(stuck.root, health);
  t.check(err, { name: "template-updates", ok: false, message: "1 template update parked for review: _config/procedures/refresh-maps.procedure.card. A parked update belongs to a task that is failing: refresh-maps — _config/procedures/refresh-maps.procedure.card; the fix may already be on disk. Run bbx template diff <path>, then bbx template accept <path> or keep/merge the local file and run bbx template resolve <path>.", severity: "error" });

  // Without the schedule health (the dashboard and `/api/health` have none loaded)
  // the same box reports the un-escalated, drift-only verdict rather than guessing:

  // doctest:L100
  t.check(await templateUpdatesCheck(stuck.root), { name: "template-updates", ok: false, message: "1 template update parked for review: _config/procedures/refresh-maps.procedure.card. Run bbx template diff <path>, then bbx template accept <path> or keep/merge the local file and run bbx template resolve <path>.", severity: "warning" });

  // The failing task's own line carries the note wherever a task speaks — the
  // session-start summary and proactive alerts both build on
  // `describeUnhealthyTask` + `describeParkedUpdates`:

  // doctest:L109
  t.check(summarizeScheduleHealth(health, NOW), "refresh-maps: failing ×5 (never succeeded) — parked update: _config/_template-updates/_config/procedures/refresh-maps.procedure.card — the fix may already be on disk");
});

// ## An unjudged task escalates too, and says which state it is in
//
// `failing` and `inconclusive` both escalate — a parked fix that nobody has read
// matters either way — but they are not the same fact, and the message says
// which. "A task that is not working" covered both, which is exactly the collapse
// this area exists to undo: an inconclusive task is unknown, not broken.
void test("failing and inconclusive both escalate — a parked fix that nobody has read ma...", async (t) => {
  t.teardown(async () => {
    try {
      await unjudged.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L125
  const unjudged = await makeTmpBox({ git: true });
  await unjudged.write("_config/schedules/refresh-maps.scheduled-script.card", scheduleCard("bbx procedure run refresh-maps"));
  await unjudged.write("_config/procedures/refresh-maps.procedure.card", procedureCard);
  await unjudged.write("_config/_template-updates/_config/procedures/refresh-maps.procedure.card", procedureCard.replace("MAP.md", "MAP.md, skipping doubled path segments"));
  await saveScriptState({
    boxRoot: unjudged.root,
    scriptName: "refresh-maps",
    state: normalizeScriptState({
      lastRun: "2026-08-24T05:00:10Z",
      lastResult: "inconclusive",
      lastError: "Inconclusive: procedure refresh-maps — review of step maps reached max turns (16); work completed",
    }),
  });
  const unjudgedHealth = await loadScheduleHealth(unjudged.root, NOW);
  const unjudgedCheck = await templateUpdatesCheck(unjudged.root, unjudgedHealth);
  t.check(unjudgedCheck, { name: "template-updates", ok: false, message: "1 template update parked for review: _config/procedures/refresh-maps.procedure.card. A parked update belongs to a task whose last check reached no verdict: refresh-maps — _config/procedures/refresh-maps.procedure.card; the fix may already be on disk. Run bbx template diff <path>, then bbx template accept <path> or keep/merge the local file and run bbx template resolve <path>.", severity: "error" });
});

// ## A task whose own card is parked, and one with no relation
//
// A parked update only attaches to a task it actually belongs to: the task's own
// `_config/schedules/<name>.scheduled-script.card`, or the procedure its `runs`
// command executes. An unrelated parked guide attaches to nothing.
void test("A parked update only attaches to a task it actually belongs to:", async (t) => {
  // doctest:L158
  const parked = ["_config/briefing.guide.card", "_config/procedures/refresh-maps.procedure.card", "_config/schedules/check-email.scheduled-script.card"];
  t.check({ ownCard: parkedUpdatesForTask({ name: "check-email", runs: "bbx wakeup --connector gmail" }, parked), viaProcedure: parkedUpdatesForTask({ name: "refresh-maps", runs: "bbx procedure run refresh-maps" }, parked), unrelated: parkedUpdatesForTask({ name: "chat-review", runs: "bbx chat review run" }, parked) }, {
    ownCard: [
      "_config/schedules/check-email.scheduled-script.card",
    ],
    viaProcedure: [
      "_config/procedures/refresh-maps.procedure.card",
    ],
    unrelated: [],
  });

  // `runs` is a shell command, so the procedure is read out of it the way
  // `bbx procedure run` resolves its argument: a bare name under
  // `_config/procedures/`, an explicit card path as given.

  // doctest:L168
  t.check([procedureCardForRuns("bbx procedure run process-pages"), procedureCardForRuns("cd /box && bbx procedure run 'refresh maps'"), procedureCardForRuns("bbx procedure run _config/procedures/custom.procedure.card"), procedureCardForRuns("bbx procedure gc"), procedureCardForRuns("bbx wakeup")], [
    "_config/procedures/process-pages.procedure.card",
    "_config/procedures/refresh maps.procedure.card",
    "_config/procedures/custom.procedure.card",
    null,
    null,
  ]);

  // An option that takes a value swallows it, the way the CLI's own parser does.
  // Skipping the flag but not its value read the value as the procedure name —
  // `--step maps refresh-maps` resolved to `maps`, linking the task to a card that
  // does not exist and hiding the parked fix for the one that does.

  // doctest:L178
  t.check(
    [
      procedureCardForRuns("bbx procedure run --step maps refresh-maps"),
      procedureCardForRuns("bbx procedure run --directive 'be brief' --force refresh-maps"),
      procedureCardForRuns("bbx procedure run --step=maps refresh-maps"),
      procedureCardForRuns("bbx procedure run --dry-run refresh-maps && bbx wakeup"),
      procedureCardForRuns("bbx procedure run refresh-maps; echo done"),
      procedureCardForRuns("bbx procedure run --step maps"),
    ],
    [
    "_config/procedures/refresh-maps.procedure.card",
    "_config/procedures/refresh-maps.procedure.card",
    "_config/procedures/refresh-maps.procedure.card",
    "_config/procedures/refresh-maps.procedure.card",
    "_config/procedures/refresh-maps.procedure.card",
    null,
  ],
  );
});

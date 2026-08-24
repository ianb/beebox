# health: parked template updates

An upstream template change that can't be written (the box copy diverged) is
parked in `config/_template-updates/<path>`. Before this check, `cb health`
mentioned templates zero times, so a corrected procedure card could sit parked
while the task that runs it failed identically, round after round
(`issues/bugs/2026-08-24-parked-template-updates-are-invisible-in-health.md`).

```ts setup
import { templateUpdatesCheck } from "../../src/webapp/trpc/routers/health-templates.js";
import { loadScheduleHealth, summarizeScheduleHealth } from "../../src/core/schedule/health-box.js";
import { saveScriptState, normalizeScriptState } from "../../src/core/schedule/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import {
  parkedUpdatesForTask,
  procedureCardForRuns,
} from "../../src/core/schedule/parked-templates.js";

const NOW = new Date("2026-08-24T12:00:00Z");

const scheduleCard = (runs: string) =>
  `---\ncron: "0 5 * * *"\nruns: ${runs}\ndescription: Refresh the box's maps\n---\n`;

const procedureCard = "---\nsteps:\n  - name: refresh\n    instructions: Rebuild MAP.md\n---\n";
```

## Nothing parked

The quiet case says so rather than staying silent — the check is enumerated in
`cb health`'s pass count either way.

```ts
const clean = await makeTmpBox({ git: true });
const ok = await templateUpdatesCheck(clean.root);
JSON.stringify({ name: ok.name, ok: ok.ok, severity: ok.severity, message: ok.message })
=> {"name":"template-updates","ok":true,"severity":"warning","message":"No template updates parked for review"}
```

```ts cleanup
await clean.cleanup();
```

## Parked updates with no failing task: `warning`, listing paths and the way out

Drift is a pending choice, not a defect, so it must not fail a deploy. The
message ends with the same resolution sentence `cb status` prints — both read it
from `PARKED_TEMPLATE_RESOLUTION`, so the instruction can't drift between them.

```ts
const drifted = await makeTmpBox({ git: true });
await drifted.write("config/_template-updates/config/briefing.guide.card", "---\n---\nstock\n");
await drifted.write("config/_template-updates/config/procedures/refresh-maps.procedure.card", procedureCard);
const warn = await templateUpdatesCheck(drifted.root);
JSON.stringify({ ok: warn.ok, severity: warn.severity })
=> {"ok":false,"severity":"warning"}

warn.message
=> 2 template updates parked for review: config/briefing.guide.card, config/procedures/refresh-maps.procedure.card. Accept one by copying config/_template-updates/<path> over <path>, or discard the parked copy.
```

```ts cleanup
await drifted.cleanup();
```

## A parked update behind a failing task escalates to `error`

The trap: the live procedure card carries the old text, the fix is parked, and
the task that runs it fails on every occurrence. That is not drift — it is a
known-broken task whose fix is already on disk, so the check names the task and
raises severity.

```ts
const stuck = await makeTmpBox({ git: true });
await stuck.write("config/schedules/refresh-maps.scheduled-script.card", scheduleCard("cb procedure run refresh-maps"));
await stuck.write("config/procedures/refresh-maps.procedure.card", procedureCard);
await stuck.write("config/_template-updates/config/procedures/refresh-maps.procedure.card", procedureCard.replace("MAP.md", "MAP.md, skipping doubled path segments"));
const state = normalizeScriptState({ lastRun: "2026-08-24T05:00:10Z", lastResult: "failure", consecutiveFailures: 5, lastError: "step refresh failed" });
await saveScriptState({ boxRoot: stuck.root, scriptName: "refresh-maps", state });
const health = await loadScheduleHealth(stuck.root, NOW);
JSON.stringify(health.tasks.map((t) => ({ name: t.name, status: t.status, parked: t.parkedTemplateUpdates })))
=> [{"name":"refresh-maps","status":"failing","parked":["config/procedures/refresh-maps.procedure.card"]}]
```

The task association is computed in `health-box.ts`, not in the CLI, so the
dashboard and `--json` carry it too. The check reads it:

```ts continue
const err = await templateUpdatesCheck(stuck.root, health);
JSON.stringify({ ok: err.ok, severity: err.severity })
=> {"ok":false,"severity":"error"}

err.message
=> 1 template update parked for review: config/procedures/refresh-maps.procedure.card. A parked update belongs to a task that is failing: refresh-maps — config/procedures/refresh-maps.procedure.card; the fix may already be on disk. Accept one by copying config/_template-updates/<path> over <path>, or discard the parked copy.
```

Without the schedule health (the dashboard and `/api/health` have none loaded)
the same box reports the un-escalated, drift-only verdict rather than guessing:

```ts continue
(await templateUpdatesCheck(stuck.root)).severity
=> warning
```

The failing task's own line carries the note wherever a task speaks — the
session-start summary and proactive alerts both build on
`describeUnhealthyTask` + `describeParkedUpdates`:

```ts continue
summarizeScheduleHealth(health, NOW)
=> refresh-maps: failing ×5 (never succeeded) — parked update: config/_template-updates/config/procedures/refresh-maps.procedure.card — the fix may already be on disk
```

```ts cleanup
await stuck.cleanup();
```

## An unjudged task escalates too, and says which state it is in

`failing` and `inconclusive` both escalate — a parked fix that nobody has read
matters either way — but they are not the same fact, and the message says
which. "A task that is not working" covered both, which is exactly the collapse
this area exists to undo: an inconclusive task is unknown, not broken.

```ts
const unjudged = await makeTmpBox({ git: true });
await unjudged.write("config/schedules/refresh-maps.scheduled-script.card", scheduleCard("cb procedure run refresh-maps"));
await unjudged.write("config/procedures/refresh-maps.procedure.card", procedureCard);
await unjudged.write("config/_template-updates/config/procedures/refresh-maps.procedure.card", procedureCard.replace("MAP.md", "MAP.md, skipping doubled path segments"));
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
print(unjudgedCheck.severity);
print(unjudgedCheck.message);
=>
error
1 template update parked for review: config/procedures/refresh-maps.procedure.card. A parked update belongs to a task whose last check reached no verdict: refresh-maps — config/procedures/refresh-maps.procedure.card; the fix may already be on disk. Accept one by copying config/_template-updates/<path> over <path>, or discard the parked copy.
```

```ts cleanup
await unjudged.cleanup();
```

## A task whose own card is parked, and one with no relation

A parked update only attaches to a task it actually belongs to: the task's own
`config/schedules/<name>.scheduled-script.card`, or the procedure its `runs`
command executes. An unrelated parked guide attaches to nothing.

```ts
const parked = ["config/briefing.guide.card", "config/procedures/refresh-maps.procedure.card", "config/schedules/check-email.scheduled-script.card"];
JSON.stringify({ ownCard: parkedUpdatesForTask({ name: "check-email", runs: "cb wakeup --connector gmail" }, parked), viaProcedure: parkedUpdatesForTask({ name: "refresh-maps", runs: "cb procedure run refresh-maps" }, parked), unrelated: parkedUpdatesForTask({ name: "chat-review", runs: "cb chat review run" }, parked) })
=> {"ownCard":["config/schedules/check-email.scheduled-script.card"],"viaProcedure":["config/procedures/refresh-maps.procedure.card"],"unrelated":[]}
```

`runs` is a shell command, so the procedure is read out of it the way
`cb procedure run` resolves its argument: a bare name under
`config/procedures/`, an explicit card path as given.

```ts continue
JSON.stringify([procedureCardForRuns("cb procedure run process-pages"), procedureCardForRuns("cd /box && cb procedure run 'refresh maps'"), procedureCardForRuns("cb procedure run config/procedures/custom.procedure.card"), procedureCardForRuns("cb procedure gc"), procedureCardForRuns("cb wakeup")])
=> ["config/procedures/process-pages.procedure.card","config/procedures/refresh maps.procedure.card","config/procedures/custom.procedure.card",null,null]
```

An option that takes a value swallows it, the way the CLI's own parser does.
Skipping the flag but not its value read the value as the procedure name —
`--step maps refresh-maps` resolved to `maps`, linking the task to a card that
does not exist and hiding the parked fix for the one that does.

```ts continue
JSON.stringify([
  procedureCardForRuns("cb procedure run --step maps refresh-maps"),
  procedureCardForRuns("cb procedure run --directive 'be brief' --force refresh-maps"),
  procedureCardForRuns("cb procedure run --step=maps refresh-maps"),
  procedureCardForRuns("cb procedure run --dry-run refresh-maps && cb wakeup"),
  procedureCardForRuns("cb procedure run refresh-maps; echo done"),
  procedureCardForRuns("cb procedure run --step maps"),
])
=> ["config/procedures/refresh-maps.procedure.card","config/procedures/refresh-maps.procedure.card","config/procedures/refresh-maps.procedure.card","config/procedures/refresh-maps.procedure.card","config/procedures/refresh-maps.procedure.card",null]
```

# `bbx engine todo-review` — the todo-review procedure's check and verify

The stock `todo-review` procedure (`docs/plans/todos-ui.md`, Track 7) runs
daily. Its precheck is `bbx engine todo-review check`: sweep the box, save
the items, and print the brief the agent works from, or exit
`CHECK_SKIP_CODE` (75) so no agent runs. No job card is written, so the
wakeup reactor has nothing to pick up. Its validate step is
`bbx engine todo-review verify`: every item must end with a status change
(the agent's own todos) or a `recheck` date 1 to 90 days out, and on a
boxholder's todo nothing but `recheck` may change. The third unchanged
recheck on a todo retires it to `recheck="never"`.

These run the commands the procedure runs, against a tmp box. The agent's
part is played by editing the card directly.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { todoReviewCommand } from "../../../src/cli/commands/todo-review.js";
import { findJobCards } from "../../../src/core/reactor/job-discovery.js";
import { createTodoReviewJobTemplate } from "../../../src/schemas/todo-review-job.js";
import { unreviewedTodosCheck } from "../../../src/webapp/trpc/routers/health-todos.js";
import { runHousekeeping } from "../../../src/cli/commands/wakeup-housekeeping.js";
import { installProcedures, installSchedules } from "../../../src/core/box/defaults.js";
import { loadProcedureDefinition } from "../../../src/core/procedure/engine-parse.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";
const CARD = "store/Porch.memo.card";

function memo(body: string): string {
  return `---\n${MEMO_FM}---\n${body}`;
}

function setTime(iso: string): void {
  process.env.BBX_TIME = iso;
}

class Exited extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit ${String(code)}`);
    this.name = "Exited";
    this.code = code;
  }
}

/** Run `bbx engine todo-review <args>` in `root`; its exit code and stdout lines. */
async function run(root: string, args: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const log = console.log;
  const exit = process.exit;
  const cwd = process.cwd();
  console.log = (...parts: unknown[]) => { out.push(parts.map(String).join(" ")); };
  process.exit = (code?: number | string | null) => { throw new Exited(Number(code ?? 0)); };
  process.chdir(root);
  try {
    await todoReviewCommand.parseAsync(args, { from: "user" });
    return { code: 0, out };
  } catch (e) {
    if (e instanceof Exited) return { code: e.code, out };
    throw e;
  } finally {
    console.log = log;
    process.exit = exit;
    process.chdir(cwd);
  }
}

// America/Chicago; 12:00Z is morning of the same calendar day there.
async function seedBox() {
  const box = await makeTmpBox({ git: true });
  await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
  box.commitAll("timezone");
  return box;
}

async function pendingJobs(root: string): Promise<number> {
  return (await findJobCards(path.join(root, "_bookkeeping/jobs"), { sourceFilter: "todo-review" })).length;
}

/** An edit to the card, committed: the review agent's, or the boxholder's. */
async function edit(root: string, change: { from: string; to: string }): Promise<void> {
  const file = path.join(root, CARD);
  const content = await fs.readFile(file, "utf-8");
  if (!content.includes(change.from)) throw new Error(`card does not contain ${change.from}`);
  await fs.writeFile(file, content.replace(change.from, change.to));
  execSync("git add -A && git commit -q -m edit", { cwd: root, stdio: "pipe" });
}

/** One daily cycle: check hands out the todo, the agent edits it, verify runs. */
async function cycle(root: string, input: { day: string; from: string; to: string }) {
  setTime(`${input.day}T12:00:00.000Z`);
  const checked = await run(root, ["check"]);
  if (checked.code !== 0) throw new Error(`check exited ${String(checked.code)}`);
  await edit(root, input);
  return run(root, ["verify"]);
}

async function quietly(fn: () => Promise<void>): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
}

/** 26 escalated todos (written newest due first), one stirring, one stale. */
function manyTodosCard(): string {
  const lines = Array.from({ length: 26 }, (_, i) => {
    const nn = String(26 - i).padStart(2, "0");
    return `{% todo due="2026-08-${nn}" %}Task ${nn}{% /todo %}`;
  });
  lines.push('{% todo start="2026-09-24" due="2026-10-30" %}Book the painter{% /todo %}');
  lines.push('{% todo created="2026-06-01" %}Sort the shed{% /todo %}');
  return memo(`${lines.join("\n\n")}\n`);
}

/** What the agent does with every item `check` saved: a recheck on each, in one commit. */
async function recheckAllShown(root: string, recheck: string): Promise<void> {
  const state = JSON.parse(await fs.readFile(path.join(root, ".beebox/todo-review-sweep.json"), "utf-8"));
  const file = path.join(root, CARD);
  let content = await fs.readFile(file, "utf-8");
  for (const item of state.review.items) {
    content = content.replace(` %}${item.text}{%`, ` recheck="${recheck}" %}${item.text}{%`);
  }
  await fs.writeFile(file, content);
  execSync("git add -A && git commit -q -m recheck", { cwd: root, stdio: "pipe" });
}

async function rechecks(root: string): Promise<string[]> {
  const state = JSON.parse(await fs.readFile(path.join(root, ".beebox/todo-review-sweep.json"), "utf-8"));
  return Object.keys(state.rechecks);
}
```

## Nothing to review: `check` exits CHECK_SKIP

```ts
const empty = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await empty.write(CARD, memo('{% todo due="2026-12-01" %}Paint the rail{% /todo %}\n'));

JSON.stringify(await run(empty.root, ["check"]))
=> {"code":75,"out":["No todos to review"]}
```

`verify` with no review saved is an error, not a pass:

```ts continue
await run(empty.root, ["verify"])
=> throws TodoReviewNotCheckedError
```

```ts cleanup
await empty.cleanup();
```

## One escalated todo: `check` prints the brief and writes no job card

The brief is the review instructions (the same text a legacy job card
carries), today's box-local date, and the items as YAML. It reaches the
agent as the precheck's output.

```ts
const box = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await box.write(CARD, memo('{% todo due="2026-09-01" %}Order lumber{% /todo %}\n'));
box.commitAll("porch");

const first = await run(box.root, ["check"]);
first.code
=> 0

const brief = first.out.join("\n");
brief.startsWith("# Processing a Todo Review") && brief.includes("Today (box-local) is 2026-09-25.")
=> true

brief.slice(brief.indexOf("```yaml"))
=>
«codeblock»yaml
escalated:
  - locator: store/Porch.memo.card:5
    text: Order lumber
    detail: due 2026-09-01
    card: '{% todo due="2026-09-01" %}Order lumber{% /todo %}'
«codeblock»

await pendingJobs(box.root)
=> 0
```

## `verify` fails an item left open without a recheck, and passes it once rechecked

The validate step names the item and why, and exits 1 (the procedure then
re-invokes the agent with this output).

```ts continue
JSON.stringify(await run(box.root, ["verify"]))
=> {"code":1,"out":["1 todo review item(s) are not settled:","- store/Porch.memo.card:5 \"Order lumber\": still open with no recheck date"]}
```

A `recheck` more than 90 days out, and a `recheck="never"` the agent wrote
itself, are both refused:

```ts continue
await edit(box.root, { from: '{% todo due="2026-09-01" %}', to: '{% todo due="2026-09-01" recheck="2027-03-01" %}' });
(await run(box.root, ["verify"])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": recheck 2027-03-01 is 157 days from today (2026-09-25); it must be 1-90 days out

await edit(box.root, { from: 'recheck="2027-03-01"', to: 'recheck="never"' });
(await run(box.root, ["verify"])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": recheck="never" is set only by the review itself; give a date 1-90 days out
```

Ten days out, with a reason after the closing tag, settles it:

```ts continue
await edit(box.root, {
  from: '{% todo due="2026-09-01" recheck="never" %}Order lumber{% /todo %}',
  to: '{% todo due="2026-09-01" recheck="2026-10-05" %}Order lumber{% /todo %} — quote due next week',
});
JSON.stringify(await run(box.root, ["verify"]))
=> {"code":0,"out":["Every todo review item is settled"]}
```

## On a boxholder's todo, only `recheck` may change

Marking the boxholder's todo done, moving its date, or rewording it all fail,
and say what was changed. (A reworded todo is not found by the words `check`
saved.)

```ts continue
setTime("2026-10-06T12:00:00.000Z");
(await run(box.root, ["check"])).code
=> 0

await edit(box.root, { from: '{% todo due="2026-09-01" recheck="2026-10-05" %}', to: '{% todo status="done" due="2026-10-20" recheck="2026-10-10" %}' });
(await run(box.root, ["verify"])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": the review may change only recheck on the boxholder's todos (changed: status, due)

await edit(box.root, { from: '{% todo status="done" due="2026-10-20" recheck="2026-10-10" %}Order lumber', to: '{% todo due="2026-09-01" recheck="2026-10-10" %}Order cedar lumber' });
(await run(box.root, ["verify"])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": not found on its card as written: the review may not reword the boxholder's todos
```

```ts cleanup
await box.cleanup();
```

## The agent's own todo may change status, or be reworded

```ts
const own = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await own.write(CARD, memo('{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-09-01" %}Tidy the index{% /todo %}\n'));
own.commitAll("own");
(await run(own.root, ["check"])).code
=> 0

await edit(own.root, { from: '{% todo assigned="agent"', to: '{% todo status="done" assigned="agent"' });
(await run(own.root, ["verify"])).out[0]
=> Every todo review item is settled

await edit(own.root, { from: 'status="done" ', to: "" });
(await run(own.root, ["check"])).code
=> 0

await edit(own.root, { from: "Tidy the index", to: "Tidy the index cards" });
(await run(own.root, ["verify"])).out[0]
=> Every todo review item is settled
```

```ts cleanup
await own.cleanup();
```

## A review that never settles keeps a newly stirring todo

The stirring baseline moves only when `verify` passes. A run whose agent
left the item unsettled lists the stirring todo again the next day; after a
passing review it is no longer stirring.

```ts
const stir = await seedBox();
await stir.write(CARD, memo('{% todo start="2026-09-24" due="2026-10-30" %}Book the painter{% /todo %}\n'));
stir.commitAll("painter");
setTime("2026-09-25T12:00:00.000Z");
await run(stir.root, ["check"]);
(await run(stir.root, ["verify"])).code
=> 1

setTime("2026-09-26T12:00:00.000Z");
(await run(stir.root, ["check"])).out.join("\n").includes("stirring:")
=> true

await edit(stir.root, { from: 'due="2026-10-30" %}', to: 'due="2026-10-30" recheck="2026-09-27" %}' });
(await run(stir.root, ["verify"])).code
=> 0

setTime("2026-09-28T12:00:00.000Z");
(await run(stir.root, ["check"])).code
=> 75
```

```ts cleanup
await stir.cleanup();
```

## The brief carries at most 25 todos, and the cut ones come back

Escalated first (oldest `due` first), then stirring, then stale. The brief
says how many were cut. Here 26 escalated todos fill the cap, so the last
escalated one, the stirring one, and the stale one wait for a later run.

```ts
const many = await seedBox();
await many.write(CARD, manyTodosCard());
many.commitAll("many");
setTime("2026-09-25T12:00:00.000Z");

const capped = (await run(many.root, ["check"])).out.join("\n");
capped.includes("25 of 28 shown; the rest come in later runs.")
=> true

const saved = JSON.parse(await fs.readFile(path.join(many.root, ".beebox/todo-review-sweep.json"), "utf-8")).review.items.map((i) => i.text);
`${String(saved.length)}: ${saved[0]} … ${saved[24]}`
=> 25: Task 01 … Task 25
```

The agent rechecks all 25 and the review passes. Because a stirring todo
was cut, the stirring baseline does not move: the next run still lists the
painter as stirring, with the other two cut todos.

```ts continue
await recheckAllShown(many.root, "2026-10-20");
(await run(many.root, ["verify"])).out[0]
=> Every todo review item is settled

setTime("2026-09-26T12:00:00.000Z");
const rest = (await run(many.root, ["check"])).out.join("\n");
rest.slice(rest.indexOf("## The items"))
=>
## The items
«blankline»
«codeblock»yaml
escalated:
  - locator: store/Porch.memo.card:5
    text: Task 26
    detail: due 2026-08-26
«*»
stirring:
  - locator: store/Porch.memo.card:57
    text: Book the painter
    detail: started 2026-09-24
«*»
stale:
  - locator: store/Porch.memo.card:59
    text: Sort the shed
    detail: created 2026-06-01
«*»
«codeblock»
```

Once those are settled too, the baseline moves and the painter is no longer
stirring.

```ts continue
await recheckAllShown(many.root, "2026-10-20");
(await run(many.root, ["verify"])).out[0]
=> Every todo review item is settled

setTime("2026-09-27T12:00:00.000Z");
(await run(many.root, ["check"])).code
=> 75
```

```ts cleanup
await many.cleanup();
```

## A legacy job card is the reactor's, not the procedure's

A `todo-review` job card queued by the old wakeup hook still validates and
stays pending for the reactor; `check` neither hands it out nor removes it.

```ts
const legacy = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await legacy.write(
  "_bookkeeping/jobs/2026-09-20T06-30.todo-review.job.card",
  createTodoReviewJobTemplate({ escalated: [{ locator: "store/Old.memo.card:5", text: "Old item", detail: "due 2026-09-01" }], stirring: [], stale: [] }),
);
legacy.commitAll("legacy job");
JSON.stringify(await run(legacy.root, ["check"]))
=> {"code":75,"out":["No todos to review"]}

await pendingJobs(legacy.root)
=> 1
```

```ts cleanup
await legacy.cleanup();
```

## The third unchanged recheck retires the todo, commits, and raises a health warning

Each daily cycle: the recheck date passes, `check` lists the todo again, the
agent pushes it out again, `verify` counts it. The third time, `verify`
writes `recheck="never"` itself and commits.

```ts
const tired = await seedBox();
await tired.write(CARD, memo('{% todo due="2026-09-01" %}Fix the gate{% /todo %}\n'));
tired.commitAll("gate");

(await cycle(tired.root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' })).out[0]
=> Every todo review item is settled

(await cycle(tired.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' })).out[0]
=> Every todo review item is settled

(await (unreviewedTodosCheck(tired.root))).ok
=> true

const third = await cycle(tired.root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' });
third.out[0]
=> Stopped reviewing store/Porch.memo.card:5: Fix the gate (third recheck with no change)

(await fs.readFile(path.join(tired.root, CARD), "utf-8")).split("\n")[4]
=> {% todo due="2026-09-01" recheck="never" %}Fix the gate{% /todo %}

execSync("git log -1 --format=%s", { cwd: tired.root, encoding: "utf-8" }).trim()
=> Stop reviewing todo: Fix the gate
```

The todo is out of the review for good (the next check skips), and the health
check names it:

```ts continue
setTime("2026-11-30T12:00:00.000Z");
(await run(tired.root, ["check"])).code
=> 75

const health = await unreviewedTodosCheck(tired.root);
JSON.stringify([health.name, health.ok, health.severity])
=> ["todos-unreviewed",false,"warning"]

health.message
=> 1 open todo is no longer reviewed: store/Porch.memo.card:5 "Fix the gate". Remove recheck="never" or edit one to put it back in review.
```

## `check` prunes the recheck history of todos that are gone

The history is keyed by card path and the todo's words. Once the card is
gone, the next check drops its entry.

```ts continue
(await rechecks(tired.root)).length
=> 1

await fs.rm(path.join(tired.root, CARD));
await run(tired.root, ["check"]);
(await rechecks(tired.root)).length
=> 0
```

```ts cleanup
await tired.cleanup();
```

## Any change to status, `start`, or `due` restarts the count

Two rechecks, then the boxholder moves the due date between reviews. The
next recheck is the first of a new count, so the third push in total retires
nothing. A reworded todo's old entry is pruned from the history.

```ts
const tended = await seedBox();
await tended.write(CARD, memo('{% todo due="2026-09-01" %}Call the roofer{% /todo %}\n'));
tended.commitAll("roofer");

await cycle(tended.root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' });
await cycle(tended.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' });
await edit(tended.root, { from: 'due="2026-09-01"', to: 'due="2026-10-01"' });
const afterEdit = await cycle(tended.root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' });
afterEdit.out[0]
=> Every todo review item is settled

(await fs.readFile(path.join(tended.root, CARD), "utf-8")).includes('recheck="never"')
=> false

await edit(tended.root, { from: "Call the roofer", to: "Call the roofer again" });
await run(tended.root, ["check"]);
await rechecks(tended.root)
=> []
```

```ts cleanup
await tended.cleanup();
```

## The health check is quiet with no retired todos, and ignores agent follow-ups

```ts
const quiet = await seedBox();
await quiet.write(
  CARD,
  memo(
    '{% todo recheck="2026-10-01" %}Rechecked, still reviewed{% /todo %}\n\n' +
    '{% todo assigned="agent" by="agent" created="2026-09-01" recheck="never" %}Agent follow-up{% /todo %}\n\n' +
    '{% todo status="done" recheck="never" %}Finished{% /todo %}\n'
  )
);
JSON.stringify(await unreviewedTodosCheck(quiet.root))
=> {"name":"todos-unreviewed","ok":true,"message":"every open todo is still reviewed","severity":"warning"}
```

```ts cleanup
await quiet.cleanup();
```

## `bbx wakeup` housekeeping no longer runs the sweep

The sweep moved to the procedure. An escalated todo on a box whose wakeup
runs housekeeping queues no job.

```ts
const woken = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await woken.write(CARD, memo('{% todo due="2026-09-01" %}Order lumber{% /todo %}\n'));
woken.commitAll("porch");
await quietly(() => runHousekeeping(woken.root));
await pendingJobs(woken.root)
=> 0
```

```ts cleanup
await woken.cleanup();
```

## Every box gets the procedure and its daily schedule, enabled

An absent `enabled` means enabled. The precheck's output is passed to the
agent (`pass-output`), which is how the brief reaches it; the validate step
reads the saved items back from the sweep state.

```ts
const fresh = await makeTmpBox({ git: true });
(await installProcedures(fresh.root)).includes("todo-review.procedure.card")
=> true

(await installSchedules(fresh.root)).includes("todo-review.scheduled-script.card")
=> true

const sched = await fs.readFile(path.join(fresh.root, "_config/schedules/todo-review.scheduled-script.card"), "utf-8");
sched.split("\n").filter((line) => /^(cron|not-before|timeout|enabled|runs):/.test(line)).join("\n")
=>
cron: 30 6 * * *
not-before: 20h
timeout: 30m
runs: bbx procedure run todo-review

const def = await loadProcedureDefinition(path.join(fresh.root, "_config/procedures/todo-review.procedure.card"));
JSON.stringify(def.steps.map((s) => [s.id, s.precheck?.shells[0]?.split("\n")[0], s.precheck?.passOutput, s.run?.agents.length, s.run?.agents[0]?.maxTurns, s.validate?.phase.shells, s.validate?.severity]))
=> [["review","bbx engine todo-review check",true,1,20,["bbx engine todo-review verify"],"review"]]

def.steps[0]?.run?.agents[0]?.prompt.includes("bbx finish")
=> false
```

```ts cleanup
await fresh.cleanup();
```

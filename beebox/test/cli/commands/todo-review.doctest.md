# `bbx engine todo-review` — the todo-review procedure's check and verify

The stock `todo-review` procedure (`docs/plans/todos-ui.md`, Track 7) runs
daily. Its precheck is `bbx engine todo-review check`: sweep the box, queue a
job, print the job to process, or exit `CHECK_SKIP_CODE` (75) so no agent
runs. Its validate step is `bbx engine todo-review verify`: every item must
end with a status change, or a `recheck` date 1 to 90 days out, or an edit.
The third unchanged recheck on a todo retires it to `recheck="never"`.

These run the commands the procedure runs, against a tmp box. The agent's
part is played by editing the card directly.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { todoReviewCommand } from "../../../src/cli/commands/todo-review.js";
import { findJobCards } from "../../../src/core/reactor/job-discovery.js";
import { finishJob } from "../../../src/core/finish-job.js";
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

/** What the review agent does: edit the todo's opening tag, commit, finish the job. */
async function agentEdits(root: string, edit: { from: string; to: string; job: string | null }): Promise<void> {
  const file = path.join(root, CARD);
  const content = await fs.readFile(file, "utf-8");
  if (!content.includes(edit.from)) throw new Error(`card does not contain ${edit.from}`);
  await fs.writeFile(file, content.replace(edit.from, edit.to));
  execSync("git add -A && git commit -q -m review", { cwd: root, stdio: "pipe" });
  if (edit.job !== null) await finishJob({ boxRoot: root, jobRelPath: edit.job });
}

/** One daily cycle: check lists the todo, the agent edits it and finishes the job, verify runs. */
async function cycle(root: string, input: { day: string; from: string; to: string }) {
  setTime(`${input.day}T12:00:00.000Z`);
  const checked = await run(root, ["check"]);
  await agentEdits(root, { from: input.from, to: input.to, job: jobOf(checked.out) });
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

function jobOf(out: string[]): string {
  const match = /^Todo review job: (\S+)/.exec(out[0] ?? "");
  if (match?.[1] === undefined) throw new Error(`no job in ${out.join("\n")}`);
  return match[1];
}
```

## Nothing to review: `check` exits CHECK_SKIP, and no job is queued

```ts
const empty = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await empty.write(CARD, memo('{% todo due="2026-12-01" %}Paint the rail{% /todo %}\n'));

const skip = await run(empty.root, ["check"]);
JSON.stringify(skip)
=> {"code":75,"out":["No todos to review"]}

await pendingJobs(empty.root)
=> 0
```

```ts cleanup
await empty.cleanup();
```

## One escalated todo: a job is queued, and a second check hands out the same job

```ts
const box = await seedBox();
setTime("2026-09-25T12:00:00.000Z");
await box.write(CARD, memo('{% todo due="2026-09-01" %}Order lumber{% /todo %}\n'));
box.commitAll("porch");

const first = await run(box.root, ["check"]);
first.code
=> 0

first.out[0]
=> Todo review job: _bookkeeping/jobs/«*».todo-review.job.card (queued this run, 1 todo(s))

const job = jobOf(first.out);
const again = await run(box.root, ["check"]);
again.out[0] === `Todo review job: ${job} (pending from an earlier run, 1 todo(s))`
=> true

await pendingJobs(box.root)
=> 1
```

## `verify` fails an item left open without a recheck, and passes it once rechecked

The agent finished the job without touching the todo. The validate step
names the item and why, and exits 1 (the procedure then re-invokes the agent
with this output).

```ts continue
await finishJob({ boxRoot: box.root, jobRelPath: job });
const bare = await run(box.root, ["verify"]);
JSON.stringify(bare)
=> {"code":1,"out":["1 item(s) of «*» are not settled:","- store/Porch.memo.card:5 \"Order lumber\": still open with no recheck date"]}
```

A `recheck` more than 90 days out, and a `recheck="never"` the agent wrote
itself, are both refused:

```ts continue
await agentEdits(box.root, { from: '{% todo due="2026-09-01" %}', to: '{% todo due="2026-09-01" recheck="2027-03-01" %}', job: null });
(await run(box.root, ["verify", job])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": recheck 2027-03-01 is 157 days from today (2026-09-25); it must be 1-90 days out

await agentEdits(box.root, { from: 'recheck="2027-03-01"', to: 'recheck="never"', job: null });
(await run(box.root, ["verify"])).out[1]
=> - store/Porch.memo.card:5 "Order lumber": recheck="never" is set only by the review itself; give a date 1-90 days out
```

Ten days out, with a reason after the closing tag, settles it:

```ts continue
await agentEdits(box.root, {
  from: '{% todo due="2026-09-01" recheck="never" %}Order lumber{% /todo %}',
  to: '{% todo due="2026-09-01" recheck="2026-10-05" %}Order lumber{% /todo %} — quote due next week',
  job: null,
});
JSON.stringify(await run(box.root, ["verify"]))
=> {"code":0,"out":["Every item of «*» is settled"]}
```

`verify` for a job `check` never named is an error, not a pass:

```ts continue
await run(box.root, ["verify", "_bookkeeping/jobs/other.todo-review.job.card"])
=> throws TodoReviewJobUnknownError
```

## A status change, or an edit to the todo's words, also settles an item

```ts continue
setTime("2026-10-06T12:00:00.000Z");
const doneJob = jobOf((await run(box.root, ["check"])).out);
await agentEdits(box.root, { from: '{% todo due="2026-09-01" recheck="2026-10-05" %}', to: '{% todo status="done" due="2026-09-01" recheck="2026-10-05" %}', job: doneJob });
(await run(box.root, ["verify"])).code
=> 0

await agentEdits(box.root, { from: 'status="done" ', to: "", job: null });
const editJob = jobOf((await run(box.root, ["check"])).out);
await agentEdits(box.root, { from: "Order lumber{% /todo %}", to: "Order cedar lumber{% /todo %}", job: editJob });
(await run(box.root, ["verify"])).code
=> 0
```

```ts cleanup
await box.cleanup();
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
=> Every item of «*» is settled

(await cycle(tired.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' })).out[0]
=> Every item of «*» is settled

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

```ts cleanup
await tired.cleanup();
```

## Any change to status, `start`, or `due` restarts the count

Two rechecks, then the boxholder moves the due date. The next recheck is the
first of a new count, so the third push in total retires nothing.

```ts
const tended = await seedBox();
await tended.write(CARD, memo('{% todo due="2026-09-01" %}Call the roofer{% /todo %}\n'));
tended.commitAll("roofer");

await cycle(tended.root, { day: "2026-09-25", from: 'due="2026-09-01" %}', to: 'due="2026-09-01" recheck="2026-09-30" %}' });
await cycle(tended.root, { day: "2026-09-30", from: 'recheck="2026-09-30"', to: 'recheck="2026-10-10"' });
await agentEdits(tended.root, { from: 'due="2026-09-01"', to: 'due="2026-10-01"', job: null });
const afterEdit = await cycle(tended.root, { day: "2026-10-10", from: 'recheck="2026-10-10"', to: 'recheck="2026-10-20"' });
afterEdit.out[0]
=> Every item of «*» is settled

(await fs.readFile(path.join(tended.root, CARD), "utf-8")).includes('recheck="never"')
=> false
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
agent (`pass-output`), which is how the agent learns the job path; the
validate step reads it back from the sweep state, since the agent's
`bbx finish` has deleted the job card by then.

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
JSON.stringify(def.steps.map((s) => [s.id, s.precheck?.shells, s.precheck?.passOutput, s.run?.agents.length, s.run?.agents[0]?.maxTurns, s.validate?.phase.shells, s.validate?.severity]))
=> [["review",["bbx engine todo-review check\n# Prints the job to process; exits CHECK_SKIP_CODE (75) when no\n# todo needs review and no todo-review job is pending."],true,1,20,["bbx engine todo-review verify"],"review"]]
```

```ts cleanup
await fresh.cleanup();
```

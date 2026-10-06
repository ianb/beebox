# Deferred at the tick, with evidence

A scheduled `runs:` pipeline that has nothing to do exits 75 after writing
`{ "reason" }` to `$BBX_DEFER_FILE` (`bbx changes --or-skip`, `bbx judge
--or-skip`). The tick records `deferred` with that reason in
`lastDeferReason`, neither counting nor clearing failures, and `once` does not
delete the card: only `success` does. Exit 75 without a marker is not evidence
(any command may exit 75), so it is a `failure`. The reason moves the change
cursor or holds it. See docs/implemented-plans/notifications.md (Track D).

```ts setup
import { execSync } from "node:child_process";
import { runTick } from "../../../src/cli/commands/tick.js";
import { runOnWakeupScripts } from "../../../src/cli/tick-utils.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { loadScheduleHealth } from "../../../src/core/schedule/health-box.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";

const head = (box) => execSync("git rev-parse HEAD", { cwd: box.root }).toString().trim();

// Defers with the reason in `_tmp/reason` when that file exists; exits 75 with
// no marker when `_tmp/bare75` exists; otherwise succeeds.
const WATCH = `---
cron: "0 0 1 1 *"
once: true
runs: >-
  if [ -f _tmp/reason ]; then printf '{"reason":"%s"}' "$(cat _tmp/reason)" > "$BBX_DEFER_FILE"; exit 75; fi;
  if [ -f _tmp/bare75 ]; then exit 75; fi;
  true
---
`;

async function tick(box) {
  const result = await runTick(box.root, { quiet: true, script: "watch", force: true });
  const state = await loadScriptState(box.root, "watch");
  const card = await box.read("_config/schedules/watch.scheduled-script.card").then(() => "card kept", () => "card deleted");
  return `${result.scripts[0]?.status} | ${state.lastResult} ${state.lastDeferReason} failures=${state.consecutiveFailures} | ${card}`;
}

/** Defer once per reason; each run's line and whether the cursor is still `held`. */
async function deferEach(box, { reasons, held }) {
  const lines = [];
  for (const reason of reasons) {
    await box.write("_tmp/reason", reason);
    lines.push(await tick(box));
    lines.push((await loadScriptState(box.root, "watch")).lastCommit === held ? "  cursor held" : "  cursor moved");
  }
  return lines.join("\n");
}
```

## A deferral is recorded with its reason, and `once` waits for success

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/watch.scheduled-script.card", WATCH);
box.commitAll("setup");
await box.write("_tmp/reason", "no-change");
await tick(box)
=> skipped | deferred no-change failures=0 | card kept

(await loadScriptState(box.root, "watch")).lastError
=> no-change: nothing to do
```

`bbx health` shows the schedule as waiting, with the reason; waiting is not
unhealthy.

```ts continue
const [task] = (await loadScheduleHealth(box.root, new Date())).tasks;
`${task.status}: ${task.deferReason} (${task.reason})`
=> waiting: no-change (nothing to do)
```

## The cursor advances for `no-change` and `no-pass`, and holds otherwise

The items were seen and judged, so the cursor moves to HEAD. A deferral for
the budget, an unavailable judge, or a missing key holds it, so the next run
sees the same items.

```ts continue
await box.write("_content/notes/a.memo.card", "---\ntitle: A\n---\n");
box.commitAll("add a");
await box.write("_tmp/reason", "no-pass");
await tick(box)
=> skipped | deferred no-pass failures=0 | card kept

(await loadScriptState(box.root, "watch")).lastCommit === head(box)
=> true

const held = head(box);
await box.write("_content/notes/b.memo.card", "---\ntitle: B\n---\n");
box.commitAll("add b");
await deferEach(box, { reasons: ["budget", "jev-unavailable", "unconfigured"], held })
=> skipped | deferred budget failures=0 | card kept
  cursor held
skipped | deferred jev-unavailable failures=0 | card kept
  cursor held
skipped | deferred unconfigured failures=0 | card kept
  cursor held
```

## Exit 75 without a marker is a failure

```ts continue
execSync("rm _tmp/reason && touch _tmp/bare75", { cwd: box.root });
await tick(box)
=> error | failure null failures=1 | card kept

(await loadScriptState(box.root, "watch")).lastCommit === held
=> true
```

## Success records `success`, advances the cursor, and deletes the card

```ts continue
execSync("rm _tmp/bare75", { cwd: box.root });
await tick(box)
=> ran | success null failures=0 | card deleted
```

```ts cleanup
await box.cleanup();
```

## The real `bbx changes --or-skip | bbx judge --or-skip` with nothing new

The first run's cursor is HEAD, so nothing has changed: `bbx changes` defers
with `no-change`, and `bbx judge` reads empty stdin, makes no call (this box
has no key, which would defer as `unconfigured`), and keeps the first marker.
No failure is counted and the card stays.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/judgments/worth.judgment.card", `---
questions:
  worth:
    type: noul
    criteria:
      true: "Something here is worth telling the boxholder about."
      false: "Nothing is."
---
The state is the inbox cards that arrived since the last check.
`);
await box.write("_config/schedules/watch.scheduled-script.card", `---
cron: "0 0 1 1 *"
once: true
runs: bbx changes --match '_content/inbox/**' --cat --or-skip | bbx judge _config/judgments/worth.judgment.card --min worth=0.8 --or-skip --echo
---
`);
box.commitAll("setup");
await tick(box)
=> skipped | deferred no-change failures=0 | card kept

await box.read(".beebox/jev-debug.log").then(() => "judge called", () => "no judge call")
=> no judge call
```

```ts cleanup
await box.cleanup();
```

## A procedure whose prechecks all skip defers the same way

`runs: bbx procedure run <name>` is the common shape when an agent writes the
notification. When every step's precheck skips, `bbx procedure run` exits 75,
and the marker its inner `bbx changes --or-skip` wrote names the reason. A
precheck that skips without a marker had nothing to do, and records
`no-change`: `no-pass` is for a judgment that said no.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/procedures/look.procedure.card", `---
name: look
steps:
  - id: look
    precheck:
      shells:
        - bbx changes --match '_content/inbox/**' --or-skip
    run:
      shells:
        - echo ran > _tmp/ran
---
`);
await box.write("_config/procedures/bare.procedure.card", `---
name: bare
steps:
  - id: bare
    precheck:
      shells:
        - exit $CHECK_SKIP
    run:
      shells:
        - echo ran > _tmp/ran
---
`);
await box.write("_config/schedules/watch.scheduled-script.card", `---
cron: "0 0 1 1 *"
runs: bbx procedure run look
---
`);
box.commitAll("setup");
await tick(box)
=> skipped | deferred no-change failures=0 | card kept

await box.write("_config/schedules/watch.scheduled-script.card", `---
cron: "0 0 1 1 *"
runs: bbx procedure run bare
---
`);
box.commitAll("bare");
await tick(box)
=> skipped | deferred no-change failures=0 | card kept

await box.read("_tmp/ran").then(() => "a step ran", () => "no step ran")
=> no step ran
```

```ts cleanup
await box.cleanup();
```

## On wakeup: `once` deletes after success, and a deferral survives

`bbx wakeup`'s on-wakeup pass records runs through the same path as the tick,
and deletes a `once` card only after `success`, committing just that card.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/done.scheduled-script.card", "---\non-wakeup: true\nonce: true\nruns: \"true\"\n---\n");
await box.write("_config/schedules/waits.scheduled-script.card", `---
on-wakeup: true
once: true
runs: printf '{"reason":"no-change"}' > "$BBX_DEFER_FILE"; exit 75
---
`);
box.commitAll("setup");
const logs = [];
const origLog = console.log;
console.log = (...args) => { logs.push(args.join(" ")); };
const ran = await runOnWakeupScripts(box.root, new Date());
console.log = origLog;
ran
=> 1

(await box.list("_config/schedules")).split("\n").filter((p) => p.endsWith(".card")).join("\n")
=> _config/schedules/waits.scheduled-script.card

const waits = await loadScriptState(box.root, "waits");
`${waits.lastResult} ${waits.lastDeferReason} ${waits.consecutiveFailures}`
=> deferred no-change 0

execSync("git log -1 --format=%s && git status --porcelain", { cwd: box.root }).toString().trim()
=> Wakeup: remove one-shot done
```

```ts cleanup
await box.cleanup();
```

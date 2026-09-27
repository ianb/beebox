# `notify:` schedules: a reminder the tick sends itself

A scheduled-script card with `notify:` in place of `runs:` is a reminder: when
it comes due, `bbx tick` sends the notification in process through
`notifyBoxholder`, with no shell and no agent. State recording and `once`
deletion are the same as for a command. See docs/implemented-plans/notifications.md
(Track D).

```ts setup
import { runTick } from "../../../src/cli/commands/tick.js";
import { loadScriptState } from "../../../src/core/schedule/state.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// Hermetic: no engine-availability store, and every channel through its fake.
process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
process.env.BBX_NOTIFY_FAKE = "1";

/** The schedule cards left in the box. */
async function scheduleCards(box) {
  return (await box.list("_config/schedules")).split("\n").filter((p) => p.endsWith(".card")).join("\n");
}
```

## An `at` reminder fires, records success, and deletes itself

`requested-by: boxholder` makes the default loudness `loud`; the target
defaults to `chat:new`; the `context` ref is the body's last line; the
`source` is the card's path and the tag its name.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/remind-vet.scheduled-script.card", `---
at: 2020-10-02T08:30
once: true
requested-by: boxholder
notify:
  title: Call the vet about Pepper's shots
  body: Ask about the booster.
  context: _content/pets/pepper-shots.todo.card
---
`);
box.commitAll("add reminder");

const result = await runTick(box.root, { quiet: true });
JSON.stringify(result.scripts)
=> [{"name":"remind-vet","status":"ran","command":"notify: Call the vet about Pepper's shots","durationMs":«int»}]

const [sent] = await readRecent(box.root, { days: 36500 });
const { title, body, target, loudness, tag, source } = sent.intent;
JSON.stringify({ title, body, target, loudness, tag, source }, null, 2)
=> {
  "title": "Call the vet about Pepper's shots",
  "body": "Ask about the booster.\n\nContext: _content/pets/pepper-shots.todo.card",
  "target": "chat:new",
  "loudness": "loud",
  "tag": "remind-vet",
  "source": "schedule:remind-vet"
}

sent.deliveries.some((d) => d.status === "sent" && d.detail === "fake")
=> true

(await loadScriptState(box.root, "remind-vet")).lastResult
=> success

(await scheduleCards(box)).length
=> 0
```

The deletion is committed like any other one-shot's:

```ts continue
import("node:child_process").then(({ execSync }) => execSync("git log -1 --format=%s", { cwd: box.root }).toString().trim())
=> Tick: remove one-shot remind-vet
```

```ts cleanup
await box.cleanup();
```

## Without `requested-by`, the default loudness is `quiet`

A schedule the box set up for itself is quiet unless it says otherwise, and
an explicit `target` is kept.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/weekly-note.scheduled-script.card", `---
at: 2020-01-01T09:00
notify:
  title: Weekly review is ready
  target: dashboard
---
`);
box.commitAll("add note");
await runTick(box.root, { quiet: true });
const [sent] = await readRecent(box.root, { days: 36500 });
`${sent.intent.loudness} ${sent.intent.target} ${JSON.stringify(sent.intent.body)}`
=> quiet dashboard ""

await scheduleCards(box)
=> _config/schedules/weekly-note.scheduled-script.card
```

```ts cleanup
await box.cleanup();
```

## A reminder that reaches nobody is a failure, and the card stays

With no fake mode and no channel configured, nothing can carry it. The run
records `failure` with the deliveries in the error, like `bbx notify` exiting 1
inside a `runs:` pipeline, and `once` does not delete the card.

```ts
delete process.env.BBX_NOTIFY_FAKE;
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/remind-call.scheduled-script.card", `---
at: 2020-10-02T08:30
once: true
notify:
  title: Call back
---
`);
box.commitAll("add reminder");
const result = await runTick(box.root, { quiet: true });
result.scripts[0].status
=> error

const state = await loadScriptState(box.root, "remind-call");
`${state.lastResult}: ${state.lastError}`
=> failure: Not delivered: «*»

await scheduleCards(box)
=> _config/schedules/remind-call.scheduled-script.card
```

```ts cleanup
process.env.BBX_NOTIFY_FAKE = "1";
await box.cleanup();
```

# Background-task lifecycle events

The SDK reports background tasks (e.g. a backgrounded shell command) over four
`task_*` system messages. `adaptSdkMessage` normalizes them into `task`
ChatMessages, and the frontend `applyTaskEvent` reducer folds those into the
live in-flight list shown above the composer.

```ts setup
import { adaptSdkMessage } from "../../src/core/chat-session-messages.js";
import { applyTaskEvent } from "../../src/frontend/src/components/chat/background-tasks.js";

// The SDK message types are awkward to build by hand; a tiny helper casts a
// plain literal to the SDKMessage shape adaptSdkMessage consumes.
function task(fields) {
  return adaptSdkMessage({ type: "system", uuid: "u1", session_id: "s1", ...fields });
}
```

## Adapter — a task starting

`task_started` becomes a `started` event with a running status and its label:

```ts
const m = task({ subtype: "task_started", task_id: "t1", tool_use_id: "tool1", description: "Generate image" });
JSON.stringify(m.task)
=> {"phase":"started","taskId":"t1","status":"running","toolUseId":"tool1","description":"Generate image"}
```

## Adapter — ambient tasks are hidden

A `skip_transcript` task (ambient/housekeeping) is dropped so it never clutters
the transcript:

```ts
task({ subtype: "task_started", task_id: "t2", description: "housekeeping", skip_transcript: true })
=> null
```

## Adapter — progress carries elapsed time and last tool

```ts
const m = task({ subtype: "task_progress", task_id: "t1", description: "Generate image", last_tool_name: "Bash", usage: { total_tokens: 10, tool_uses: 2, duration_ms: 4200 } });
JSON.stringify(m.task)
=> {"phase":"progress","taskId":"t1","status":"running","description":"Generate image","lastToolName":"Bash","elapsedMs":4200}
```

## Adapter — settled, with status

`task_notification` is the terminal event. The status is one of
`completed | failed | stopped`:

```ts
const ok = task({ subtype: "task_notification", task_id: "t1", status: "completed", output_file: "/tmp/t1.output", summary: "done" });
JSON.stringify(ok.task)
=> {"phase":"settled","taskId":"t1","status":"completed","summary":"done","outputFile":"/tmp/t1.output"}

const bad = task({ subtype: "task_notification", task_id: "t1", status: "failed", output_file: "/tmp/t1.output", summary: "boom" });
bad.task?.status
=> failed
```

## Adapter — a state patch

`task_updated` carries only the wire-safe fields that changed:

```ts
const m = task({ subtype: "task_updated", task_id: "t1", patch: { status: "running", description: "still going" } });
JSON.stringify(m.task)
=> {"phase":"updated","taskId":"t1","status":"running","description":"still going"}
```

## Reducer — start, progress, settle

A `started` event registers a task; `progress` merges into it; `settled`
removes it (its permanent marker lives in the transcript):

```ts
let tasks = [];
tasks = applyTaskEvent(tasks, { phase: "started", taskId: "t1", description: "Generate image", status: "running" });
tasks.length
=> 1

tasks = applyTaskEvent(tasks, { phase: "progress", taskId: "t1", lastToolName: "Bash", elapsedMs: 3000 });
JSON.stringify(tasks[0])
=> {"taskId":"t1","description":"Generate image","status":"running","lastToolName":"Bash","elapsedMs":3000}

tasks = applyTaskEvent(tasks, { phase: "settled", taskId: "t1", status: "completed" });
tasks.length
=> 0
```

## Reducer — terminal status removes even without a settled phase

A `task_updated` patch carrying a terminal status drops the task from the live
list:

```ts continue
let live = applyTaskEvent([], { phase: "started", taskId: "t9", status: "running" });
live = applyTaskEvent(live, { phase: "updated", taskId: "t9", status: "failed" });
live.length
=> 0
```

## Reducer — progress for an unknown task is ignored

Ambient tasks never emit a `started` we surfaced, so a stray progress/updated
tick for an unregistered id is a no-op (no phantom pill appears):

```ts continue
applyTaskEvent([], { phase: "progress", taskId: "ghost", elapsedMs: 100 }).length
=> 0
```

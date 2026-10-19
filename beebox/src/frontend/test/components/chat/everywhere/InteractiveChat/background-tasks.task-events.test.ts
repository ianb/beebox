// # Background-task lifecycle events
//
// The SDK reports background tasks (e.g. a backgrounded shell command) over four
// `task_*` edge messages and the `background_tasks_changed` level signal.
// `adaptSdkMessage` normalizes them into `task` and `task-level` ChatMessages.
// In the frontend, `applyTaskLevel` sets which tasks the strip above the
// composer shows, and `applyTaskEvent` adds detail to those tasks.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import type {
  SDKBackgroundTasksChangedMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { adaptSdkMessage } from "../../../../../../core/chat/session/messages.js";
import type { ChatMessage } from "../../../../../../core/chat/message-types.js";
import { applyTaskEvent, applyTaskLevel, type LiveTask } from "../../../../../src/components/chat/everywhere/InteractiveChat/background-tasks.js";

// A tiny helper fills in the envelope fields every SDK task message carries.
type Envelope = "type" | "uuid" | "session_id";
type TaskFields =
  | Omit<SDKTaskStartedMessage, Envelope>
  | Omit<SDKTaskProgressMessage, Envelope>
  | Omit<SDKTaskUpdatedMessage, Envelope>
  | Omit<SDKTaskNotificationMessage, Envelope>
  | Omit<SDKBackgroundTasksChangedMessage, Envelope>;
function task(fields: TaskFields) {
  return adaptSdkMessage({ type: "system", uuid: "00000000-0000-4000-8000-000000000001", session_id: "s1", ...fields });
}
// The `task` payload of an adapted message that must be a task event.
function taskOf(m: ChatMessage | null) {
  assert.ok(m && m.type === "task");
  return m.task;
}

// ## Adapter — a task starting
//
// `task_started` becomes a `started` event with a running status and its label:
void test("taskstarted becomes a started event with a running status and its label:", async (t) => {
  const m = task({ subtype: "task_started", task_id: "t1", tool_use_id: "tool1", description: "Generate image" });
  t.check(taskOf(m), {
    phase: "started",
    taskId: "t1",
    status: "running",
    toolUseId: "tool1",
    description: "Generate image",
  });
});

// ## Adapter — ambient tasks are hidden
//
// A `skip_transcript` task (ambient/housekeeping) is dropped so it never clutters
// the transcript:
void test("A skiptranscript task (ambient/housekeeping) is dropped so it never clutters...", async (t) => {
  t.check(task({ subtype: "task_started", task_id: "t2", description: "housekeeping", skip_transcript: true }), null);
});

// A live-update watcher is `ambient` without `skip_transcript`. It is not the
// person's work either, so its start and its notification are dropped too:
void test("An ambient task that is not skiptranscript is dropped too", async (t) => {
  t.check(task({ subtype: "task_started", task_id: "w1", description: "watch build", ambient: true }), null);
  t.check(task({ subtype: "task_notification", task_id: "w1", status: "completed", output_file: "/tmp/w1.output", summary: "done", ambient: true }), null);
});

// ## Adapter — the level signal
//
// `background_tasks_changed` becomes a `task-level` message that lists every
// live task except the ambient ones:
void test("backgroundtaskschanged becomes a task-level message without ambient tasks", async (t) => {
  const m = task({
    subtype: "background_tasks_changed",
    tasks: [
      { task_id: "t1", task_type: "local_bash", description: "npm test" },
      { task_id: "w1", task_type: "monitor", description: "watch build", ambient: true },
    ],
  });
  t.check(m, { type: "task-level", session_id: "s1", uuid: "00000000-0000-4000-8000-000000000001", tasks: [{ taskId: "t1", description: "npm test" }] });
});

// ## Adapter — progress carries elapsed time and last tool
void test("Adapter — progress carries elapsed time and last tool", async (t) => {
  const m = task({ subtype: "task_progress", task_id: "t1", description: "Generate image", last_tool_name: "Bash", usage: { total_tokens: 10, tool_uses: 2, duration_ms: 4200 } });
  t.check(taskOf(m), {
    phase: "progress",
    taskId: "t1",
    status: "running",
    description: "Generate image",
    lastToolName: "Bash",
    elapsedMs: 4200,
  });
});

// ## Adapter — settled, with status
//
// `task_notification` is the terminal event, carrying its final status:
void test("tasknotification is the terminal event, carrying its final status:", async (t) => {
  const m = task({ subtype: "task_notification", task_id: "t1", status: "completed", output_file: "/tmp/t1.output", summary: "done" });
  t.check(taskOf(m), {
    phase: "settled",
    taskId: "t1",
    status: "completed",
    summary: "done",
    outputFile: "/tmp/t1.output",
  });
});

// ## Adapter — a state patch
//
// `task_updated` carries only the wire-safe fields that changed:
void test("taskupdated carries only the wire-safe fields that changed:", async (t) => {
  const m = task({ subtype: "task_updated", task_id: "t1", patch: { status: "running", description: "still going" } });
  t.check(taskOf(m), {
    phase: "updated",
    taskId: "t1",
    status: "running",
    description: "still going",
  });
});

// ## Reducer — the level sets membership, edges add detail
//
// A level payload adds a task. A `progress` event merges into it. The next level
// payload that omits it removes it:
void test("The level sets membership and edge events add detail", async (t) => {
  let tasks: LiveTask[] = [];
  tasks = applyTaskLevel(tasks, [{ taskId: "t1", description: "Generate image" }]);
  t.check(tasks, [{ taskId: "t1", description: "Generate image", status: "running" }]);

  tasks = applyTaskEvent(tasks, { phase: "progress", taskId: "t1", lastToolName: "Bash", elapsedMs: 3000 });
  t.check(tasks, [{ taskId: "t1", description: "Generate image", status: "running", lastToolName: "Bash", elapsedMs: 3000 }]);

  // A later level keeps the detail of a task that is still live:
  tasks = applyTaskLevel(tasks, [{ taskId: "t1", description: "Generate image" }, { taskId: "t2", description: "npm test" }]);
  t.check(tasks, [
    { taskId: "t1", description: "Generate image", status: "running", lastToolName: "Bash", elapsedMs: 3000 },
    { taskId: "t2", description: "npm test", status: "running" },
  ]);

  t.check(applyTaskLevel(tasks, []), []);
});

// ## Reducer — a missed bookend cannot wedge a pill
//
// The `settled` event for a task never arrives. The next level payload still
// removes the task:
void test("A missed settled event does not leave a task in the strip", async (t) => {
  let tasks = applyTaskLevel([], [{ taskId: "t1", description: "sleep 60" }]);
  tasks = applyTaskEvent(tasks, { phase: "started", taskId: "t1", description: "sleep 60", status: "running" });
  t.check(applyTaskLevel(tasks, []), []);
});

// ## Reducer — edge events never change membership
//
// A `started` event for a task outside the level adds nothing, and a `settled`
// event does not remove a task the level still lists:
void test("Edge events do not add or remove tasks", async (t) => {
  t.check(applyTaskEvent([], { phase: "started", taskId: "t1", description: "early", status: "running" }), []);
  t.check(applyTaskEvent([], { phase: "progress", taskId: "ghost", elapsedMs: 100 }), []);

  const live = applyTaskLevel([], [{ taskId: "t9", description: "build" }]);
  t.check(applyTaskEvent(live, { phase: "settled", taskId: "t9", status: "completed" }), [{ taskId: "t9", description: "build", status: "completed" }]);
});

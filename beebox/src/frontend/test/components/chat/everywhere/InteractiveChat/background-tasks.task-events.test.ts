// # Background-task lifecycle events
//
// The SDK reports background tasks (e.g. a backgrounded shell command) over four
// `task_*` system messages. `adaptSdkMessage` normalizes them into `task`
// ChatMessages, and the frontend `applyTaskEvent` reducer folds those into the
// live in-flight list shown above the composer.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { adaptSdkMessage } from "../../../../../../core/chat/session/messages.js";
import type { ChatMessage } from "../../../../../../core/chat/message-types.js";
import { applyTaskEvent, type LiveTask } from "../../../../../src/components/chat/everywhere/InteractiveChat/background-tasks.js";

// A tiny helper fills in the envelope fields every SDK task message carries.
type Envelope = "type" | "uuid" | "session_id";
type TaskFields =
  | Omit<SDKTaskStartedMessage, Envelope>
  | Omit<SDKTaskProgressMessage, Envelope>
  | Omit<SDKTaskUpdatedMessage, Envelope>
  | Omit<SDKTaskNotificationMessage, Envelope>;
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
  // doctest:L42
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
  // doctest:L53
  t.check(task({ subtype: "task_started", task_id: "t2", description: "housekeeping", skip_transcript: true }), null);
});

// ## Adapter — progress carries elapsed time and last tool
void test("Adapter — progress carries elapsed time and last tool", async (t) => {
  // doctest:L60
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
  // doctest:L70
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
  // doctest:L80
  const m = task({ subtype: "task_updated", task_id: "t1", patch: { status: "running", description: "still going" } });
  t.check(taskOf(m), {
    phase: "updated",
    taskId: "t1",
    status: "running",
    description: "still going",
  });
});

// ## Reducer — start, progress, settle
//
// A `started` event registers a task; `progress` merges into it; `settled`
// removes it (its permanent marker lives in the transcript):
void test("A started event registers a task; progress merges into it; settled removes it...", async (t) => {
  // doctest:L91
  let tasks: LiveTask[] = [];
  tasks = applyTaskEvent(tasks, { phase: "started", taskId: "t1", description: "Generate image", status: "running" });
  t.check(tasks, [{ taskId: "t1", description: "Generate image", status: "running" }]);

  // doctest:L96
  tasks = applyTaskEvent(tasks, { phase: "progress", taskId: "t1", lastToolName: "Bash", elapsedMs: 3000 });
  t.check(tasks, [{ taskId: "t1", description: "Generate image", status: "running", lastToolName: "Bash", elapsedMs: 3000 }]);

  // doctest:L100
  tasks = applyTaskEvent(tasks, { phase: "settled", taskId: "t1", status: "completed" });
  t.check(tasks, []);

  // ## Reducer — terminal status removes even without a settled phase
  //
  // A `task_updated` patch carrying a terminal status drops the task from the live
  // list:

  // doctest:L111
  let live = applyTaskEvent([], { phase: "started", taskId: "t9", status: "running" });
  live = applyTaskEvent(live, { phase: "updated", taskId: "t9", status: "failed" });
  t.check(live, []);

  // ## Reducer — progress for an unknown task is ignored
  //
  // Ambient tasks never emit a `started` we surfaced, so a stray progress/updated
  // tick for an unregistered id is a no-op (no phantom pill appears):

  // doctest:L123
  t.check(applyTaskEvent([], { phase: "progress", taskId: "ghost", elapsedMs: 100 }), []);
});

// # ChatSession reports the live background-task set
//
// The chat task strip takes its members from the `task-level` event. The CLI
// reports its live set per process and sends nothing at startup, so
// `ChatSession` reports an empty set when a run opens and again when the run
// closes. Between those, each `background_tasks_changed` message is reported
// with ambient tasks removed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { once } from "node:events";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import type { LiveTaskEntry } from "../../../../src/core/chat/message-types.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { tick } from "../../../helpers/chat-session-spawner-helpers.js";

void test("A run reports an empty set when it opens and when it closes, and the CLI's set between", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, sessionFile: null, initialSessionId: "s1" });
  const levels: LiveTaskEntry[][] = [];
  session.on("task-level", (tasks: LiveTaskEntry[]) => { levels.push(tasks); });

  await session.send("hello");
  await tick();
  t.check(levels, [[]]);

  const run = backend.lastRun();
  assert.ok(run);
  run.emitMessage({
    type: "system",
    subtype: "background_tasks_changed",
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "s1",
    tasks: [
      { task_id: "t1", task_type: "local_bash", description: "npm test" },
      { task_id: "w1", task_type: "monitor", description: "watch build", ambient: true },
    ],
  });
  await tick();
  t.check(levels, [[], [{ taskId: "t1", description: "npm test" }]]);

  // The run ends without any task_notification for t1. The set still empties:
  const closed = once(session, "close");
  session.stop();
  await closed;
  t.check(levels, [[], [{ taskId: "t1", description: "npm test" }], []]);
});

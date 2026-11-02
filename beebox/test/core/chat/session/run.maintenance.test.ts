// # A persistent SDK run retains admission across turns

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { once } from "node:events";
import assert from "node:assert/strict";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { acquireBoxWork, closeBoxMaintenance } from "../../../../src/lib/box-maintenance/admission.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { waitForRuns } from "../../../helpers/chat-session-spawner-helpers.js";

void test("line 13", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await maintenance.release();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test" });
  await session.send("first");
  const run = backend.lastRun();
  assert.ok(run);
  const done = once(session, "done");
  run.emitResult();
  await done;
  await session.send("second");
  const maintenance = await closeBoxMaintenance(box.root, { reason: "fixture", drainMs: 1000 });
  // This is the permit baked into the subprocess at spawn, after the first send's lease ended.
  const tool = await acquireBoxWork(box.root, { reason: "test", inherited: run.startOptions.env.BBX_BOX_WORK });
  await tool.release();
  t.check(run.sent, [
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
first` }],
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
second` }],
  ]);

  session.enqueue("third queued before closure");
  const secondDone = once(session, "done");
  run.emitResult();
  await secondDone;
  session.pauseForMaintenance();
  await maintenance.drain();
  await maintenance.beginChanges();
  t.check(run.sent, [
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
first` }],
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
second` }],
  ]);

  await maintenance.complete();
  session.resumeAfterMaintenance();
  await waitForRuns(backend, { count: 2, timeoutMs: 3000 });
  t.check(backend.lastRun()?.sent, [
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
third queued before closure` }],
  ]);
});

// ## Maintenance that cannot wait tells the chat why its tasks ended
//
// A deployment ends a chat that sits between turns with live background tasks
// (`docs/implemented-plans/maintenance-live-tasks.md`, Tracks 2–3). The run ends outright,
// and the next turn carries a `<run-ended>` element inside the `<chat-app>`
// snapshot, which the person's message display strips. A turn that fails to
// start keeps the note for the one after it; a dispatched turn removes it.
void test("Maintenance that cannot wait tells the chat why its tasks ended", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test", initialSessionId: "sess-1" });
  await session.send("research this");
  const run = backend.lastRun();
  assert.ok(run);
  run.emitBackgroundTasks(["collect sources"]);
  const done = once(session, "done");
  run.emitResult();
  await done;

  session.pauseForMaintenance("deployment");
  t.check({ aborted: run.aborted, note: JSON.parse(await box.read(".beebox/chat-run-ended/sess-1.json")) }, {
    aborted: true,
    note: { at: isoDate(), reason: "deployment", tasks: ["collect sources"] },
  });
  session.resumeAfterMaintenance();

  backend.failNextStart = new Error("provider down");
  await t.checkThrows(async () => session.send("did it finish?"), "Error");
  t.check(await box.list(".beebox/chat-run-ended"), ".beebox/chat-run-ended/sess-1.json");

  await session.send("did it finish?");
  t.check({ sent: backend.lastRun()?.sent, notes: await box.list(".beebox/chat-run-ended") }, {
    sent: [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended at="${isoDate()}" reason="deployment">
Box maintenance (deployment) ended your previous run while 1 background task was still running. They did not finish; restart any that are still needed.
- collect sources
</run-ended>
</chat-app>
did it finish?` }]],
    notes: "",
  });
});

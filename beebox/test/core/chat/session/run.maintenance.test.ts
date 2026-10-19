// # A persistent SDK run retains admission across turns

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
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
  // doctest:L14
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

  // doctest:L31
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

  // doctest:L41
  await maintenance.complete();
  session.resumeAfterMaintenance();
  await waitForRuns(backend, { count: 2, timeoutMs: 3000 });
  t.check(backend.lastRun()?.sent, [
    [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
third queued before closure` }],
  ]);
});

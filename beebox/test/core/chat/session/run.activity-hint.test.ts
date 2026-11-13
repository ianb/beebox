// # The activity hint on a person's turn
//
// A person's send advances the session's activity cursor and adds
// `<activity entries="N" cards="M"/>` to the `<chat-app>` snapshot when the
// window is not empty. Scheduled and self-note turns (client composed) carry
// no hint and leave the cursor alone. The first turn of a new chat has no
// session id, so its count comes from the page's own key.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { consoleLines } from "../../../helpers/console-lines.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { readCursor } from "../../../../src/core/activity/cursor.js";
import { recordActivity, withActivityLock } from "../../../../src/core/activity/log.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { waitForRuns, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";

function activityTag(blocks: readonly { type: string; text?: string }[]): string | null {
  const text = blocks.map((b) => b.text ?? "").join("\n");
  return /<activity [^>]*\/>/.exec(text)?.[0] ?? null;
}

void test("A person's turn carries the hint; a composed turn does not.", async (t) => {
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
  const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
  await recordActivity(box.root, { user: null, entries: [
    { card: "Lab.figure.card", kind: "explored", detail: "add C", pendingChat: "p1" },
    { card: "Lab.figure.card", kind: "explored", detail: "add H", pendingChat: "p1" },
    { card: "Notes.view.card", kind: "scrolled", detail: "Intro", pendingChat: "p1" },
  ] });

  await session.send({ text: "I can't make water", activityTurn: { pendingChat: "p1" } });
  await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run started");
  const done = once(session, "done");
  run.emitSessionInit("sess-1");
  run.emitResult();
  await done;
  t.check(activityTag(run.sent[0] ?? []), "<activity entries=\"3\" cards=\"2\"/>");

  await recordActivity(box.root, { user: null, entries: [{ card: "Lab.figure.card", kind: "explored", detail: "remove H", chat: "sess-1" }] });
  await session.send({ text: "<self-note>from a script</self-note>", clientComposed: true });
  t.check(activityTag(run.sent[1] ?? []), null);
  t.check((await readCursor(box.root, "sess-1"))?.hinted ?? null, null);
});

// ## A held activity lock does not hold up the send
//
// The hint is optional. When the lock stays held past a short bound, the turn
// goes without a hint and the cursor stays, so its entries fall in the next window.
void test("A held activity lock sends the turn without a hint.", async (t) => {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const warnings = consoleLines(t, "warn");
  await recordActivity(box.root, { user: null, entries: [{ card: "Lab.figure.card", kind: "explored", detail: "add C", chat: "sess-2" }] });
  await withActivityLock(box.root, async () => {
    // The run must start while the lock is still held (the unbounded wait is 5 s).
    await session.send({ text: "hello", activityTurn: {} });
    await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
    await sleep(0);
  });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run started");
  t.check(activityTag(run.sent[0] ?? []), null);
  t.check(await readCursor(box.root, "sess-2"), null);
  const warning = "[chat] could not advance the activity cursor in time; this turn carries no activity hint and its entries fall in the next window:";
  t.check(warnings().map((l) => l.slice(0, warning.length)), [warning]);
});

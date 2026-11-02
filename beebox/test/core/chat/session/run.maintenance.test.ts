// # A persistent SDK run retains admission across turns, and a chat learns why its background tasks were cut off

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str, uuid } from "@ianbicking/tap-check/check";
import { once } from "node:events";
import assert from "node:assert/strict";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { acquireBoxWork, closeBoxMaintenance } from "../../../../src/lib/box-maintenance/admission.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { waitForRuns } from "../../../helpers/chat-session-spawner-helpers.js";
import { createTaskRecorder, pendingRunEndedNote } from "../../../../src/core/chat/session/run/ended-note.js";
import { createLiveTasks } from "../../../../src/core/chat/session/run/live-tasks.js";

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

// ## A chat learns why and when its background tasks were cut off
//
// While a run has live background tasks, the session keeps a record under
// `.beebox/chat-run-ended/`; the server stamps a cause when it ends the run.
// The next turn carries a `<run-ended>` element inside the `<chat-app>`
// snapshot, which the person's message display strips
// (`docs/implemented-plans/chat-termination-notes.md`). A turn that fails to start keeps the
// note for the one after it; a dispatched turn removes it.

const NOTE = ".beebox/chat-run-ended/sess-1.json";

/** A session whose first run has one live background task, between turns. */
async function researchingSession(t: { teardown(fn: () => Promise<void>): void }) {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test", initialSessionId: "sess-1" });
  t.teardown(async () => { session.stop(); await box.cleanup(); });
  await session.send("research this");
  const run = backend.lastRun();
  assert.ok(run);
  run.emitBackgroundTasks(["collect sources"]);
  const done = once(session, "done");
  run.emitResult();
  await done;
  return { box, backend, session, run };
}

void test("Maintenance that cannot wait tells the chat why its tasks ended", async (t) => {
  const { box, backend, session, run } = await researchingSession(t);

  // While the task is live the record holds it; an ordinary turn now carries no note.
  t.check(JSON.parse(await box.read(NOTE)), { tasks: ["collect sources"], lastSeenAt: isoDate(), writer: uuid() });
  await session.send("how is it going?");
  t.check(run.sent.at(-1), [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
how is it going?` }]);
  const busy = once(session, "done");
  run.emitResult();
  await busy;

  session.pauseForMaintenance("deployment");
  t.check({ aborted: run.aborted, note: JSON.parse(await box.read(NOTE)) }, {
    aborted: true,
    note: { tasks: ["collect sources"], lastSeenAt: isoDate(), writer: uuid(), at: isoDate(), cause: "box maintenance (deployment)" },
  });
  session.resumeAfterMaintenance();

  backend.failNextStart = new Error("provider down");
  await t.checkThrows(async () => session.send("did it finish?"), "Error");
  t.check(await box.list(".beebox/chat-run-ended"), NOTE);

  await session.send("did it finish?");
  t.check({ sent: backend.lastRun()?.sent, notes: await box.list(".beebox/chat-run-ended") }, {
    sent: [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended at="${isoDate()}" cause="box maintenance (deployment)">
Your previous run ended at ${isoDate()} while 1 background task was still running, because box maintenance (deployment). They did not finish; restart any that are still needed.
- collect sources
</run-ended>
</chat-app>
did it finish?` }]],
    notes: "",
  });
});

// ## A run that ends on its own says so
//
// The agent process can exit without the server ending it (a crash, or the
// kernel killing just that process). The close handler sees live tasks and no
// recorded end.
void test("A run that ends on its own says so", async (t) => {
  const { box, backend, session, run } = await researchingSession(t);
  const closed = once(session, "close");
  await run.close();
  await closed;
  await session.send("did it finish?");
  t.check(backend.lastRun()?.sent, [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended at="${isoDate()}" cause="the agent process ended on its own">
Your previous run ended at ${isoDate()} while 1 background task was still running, because the agent process ended on its own. They did not finish; restart any that are still needed.
- collect sources
</run-ended>
</chat-app>
did it finish?` }]]);
  t.check(await box.list(".beebox/chat-run-ended"), "");
});

// ## A record no process stamped means the server itself stopped
//
// A record another server process wrote and never stamped is from a run this
// process never saw end: the server crashed or was killed (out of memory, most
// often). The note gives the last time the run was seen working. Notes the
// first, maintenance-only version wrote (`{ at, reason, tasks }`) still read.
void test("A record no process stamped means the server itself stopped", async (t) => {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test", initialSessionId: "sess-1" });
  t.teardown(async () => { session.stop(); await box.cleanup(); });
  await box.write(NOTE, JSON.stringify({ tasks: ["collect sources", "draft summary"], lastSeenAt: "2026-11-02T14:06:00.000Z", writer: "an-earlier-server" }));
  await session.send("did it finish?");
  t.check(backend.lastRun()?.sent, [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended last-seen="2026-11-02T14:06:00.000Z" cause="unknown">
Your previous run ended while 2 background tasks were running; it was last seen working at 2026-11-02T14:06:00.000Z. No cause was recorded, and the Bee Box server restarted since (at ${isoDate()}), so the server most likely crashed or was killed, for example for running out of memory. They did not finish; restart any that are still needed.
- collect sources
- draft summary
</run-ended>
</chat-app>
did it finish?` }]]);

  const done = once(session, "done");
  backend.lastRun()?.emitResult();
  await done;
  await box.write(NOTE, JSON.stringify({ at: "2026-11-02T20:05:00.000Z", reason: "deployment", tasks: ["collect sources"] }));
  await session.send("and now?");
  t.check(backend.lastRun()?.sent.at(-1), [{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}">
<run-ended at="2026-11-02T20:05:00.000Z" cause="box maintenance (deployment)">
Your previous run ended at 2026-11-02T20:05:00.000Z while 1 background task was still running, because box maintenance (deployment). They did not finish; restart any that are still needed.
- collect sources
</run-ended>
</chat-app>
and now?` }]);
});

// ## Clearing a delivered note keeps a record written since
//
// The turn that carries a note may start a run whose own tasks write a fresh
// record before the note is cleared. Clearing removes the file only if it still
// holds what was read.
void test("Clearing a delivered note keeps a record written since", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => { await box.cleanup(); });
  const recorder = createTaskRecorder(box.root, () => "sess-1");
  recorder.ended({ tasks: ["old task"], cause: "the Bee Box server shut down", now: new Date("2026-11-02T20:00:00.000Z") });
  const pending = pendingRunEndedNote(box.root, "sess-1");
  recorder.observe(["new task"], new Date("2026-11-02T20:01:00.000Z"));
  pending.clear();
  t.check(JSON.parse(await box.read(NOTE)), { tasks: ["new task"], lastSeenAt: "2026-11-02T20:01:00.000Z", writer: uuid() });

  // The new tasks settle: their unstamped record goes. A stamped one waiting for its turn would stay.
  recorder.observe([], new Date("2026-11-02T20:02:00.000Z"));
  t.check(await box.list(".beebox/chat-run-ended"), "");
});

// ## A task update in flight after the server ends a run keeps the cause
//
// The SDK may deliver one more task update between the server stamping a cause
// and the run closing. It must not overwrite the stamped record, and the note
// is held back (`ending()`) until the run has closed, so a send in that gap does
// not deliver it into a run that is still closing.
void test("A task update in flight after the server ends a run keeps the cause", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => { await box.cleanup(); });
  let clock = Date.parse("2026-11-02T20:00:00.000Z");
  const tasks = createLiveTasks(() => clock, { boxRoot: box.root, sessionId: () => "sess-1" });
  tasks.observe([{ taskId: "a", description: "collect sources" }]);
  clock += 1_000;
  tasks.recordEnd("a restart was requested");
  clock += 1_000;
  tasks.observe([{ taskId: "a", description: "collect sources" }, { taskId: "b", description: "draft summary" }]);
  tasks.noteRunMessage();
  const ending = tasks.ending();
  tasks.closed();
  t.check({ ending, after: tasks.ending(), note: JSON.parse(await box.read(NOTE)) }, {
    ending: true,
    after: false,
    note: { tasks: ["collect sources"], lastSeenAt: "2026-11-02T20:00:01.000Z", writer: uuid(), at: "2026-11-02T20:00:01.000Z", cause: "a restart was requested" },
  });
});

// ## A message sent while a restart closes the run reaches the fresh run
//
// `restart()` closes the run's input at once, but the run reads as gone only
// when its close handler runs. A send in between used to go into the closed
// input and vanish (`issues/closed/bugs/2026-11-02-send-during-run-close-silently-dropped.md`).
// The session now reads as busy until the close, so the sender queues the
// message, and the close handler drains it into a fresh run.
void test("A message sent while a restart closes the run reaches the fresh run", async (t) => {
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, { backend, skipBootstrap: true, systemPrompt: async () => "test", initialSessionId: "sess-1" });
  t.teardown(async () => { session.stop(); await box.cleanup(); });
  await session.send("first");
  const first = backend.lastRun();
  assert.ok(first);
  const done = once(session, "done");
  first.emitResult();
  await done;

  const closed = once(session, "close");
  session.restart({ cause: "a restart was requested" });
  const busyWhileClosing = session.isBusy();
  // What every sender does with a busy session.
  if (busyWhileClosing) session.enqueue("sent during the restart");
  await closed;
  await waitForRuns(backend, { count: 2, timeoutMs: 3000 });
  t.check({ busyWhileClosing, firstRun: first.sent.length, fresh: backend.lastRun()?.sent }, {
    busyWhileClosing: true,
    firstRun: 1,
    fresh: [[{ type: "text", text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>
sent during the restart` }]],
  });
});

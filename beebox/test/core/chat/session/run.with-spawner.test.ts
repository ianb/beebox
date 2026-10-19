// # ChatSession with injected backend
//
// `ChatSession` accepts a `ChatSessionOptions` bag that lets tests
// inject a fake `ChatBackend` and override the system prompt, session
// file, MCP config, env vars, and session-id callback. This doctest
// exercises the full round-trip without spawning a real Claude
// subprocess.
//
// See `service-claude-chat.doctest.md` for the fake backend API.
// Most of the helpers used below live in
// `test/helpers/chat-session-spawner-helpers.ts` — the doctest loader
// has trouble with top-level function declarations whose bodies return
// inline object literals, so the helpers are in a regular `.ts` file.

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate, str } from "agent-doctest/check";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import {
  runTurn,
  tick,
  waitForRuns,
  testPrompt,
  testPromptShort,
  plainTestPrompt,
  buildSetupOpts,
  buildReopenSetupOpts,
  buildReopenMainOpts,
  SETUP_FILE,
} from "../../../helpers/chat-session-spawner-helpers.js";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import assert from "node:assert/strict";

/** One user message as the fake backend records it: the chat-app header, then the text. */
function sentText(body: string) {
  return [{ type: "text" as const, text: str`<chat-app narration="off" prose="on" local-time="${any(String)}"/>\n${body}` }];
}

// ## Backend sees the right options
//
// `ChatSession` builds system prompt + env + resume id and hands them to
// the backend. With an override prompt and extra env the fake captures
// both:
void test("ChatSession builds system prompt + env + resume id and hands them to the back...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L43
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const opts = { backend, systemPrompt: testPrompt, extraEnv: { BBX_TEST_FOO: "foo" }, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L48
  await session.send("hello");
  await tick();

  // doctest:L51
  const run = backend.lastRun();
  assert.ok(run);
  t.check(
    {
      systemPrompt: run.startOptions.systemPrompt,
      foo: run.startOptions.env.BBX_TEST_FOO,
      resumeSessionId: run.startOptions.resumeSessionId,
    },
    { systemPrompt: "TEST PROMPT", foo: "foo", resumeSessionId: undefined },
  );
});

// ## Session ID gets assigned and persisted
//
// When the fake emits the init system message with a `session_id`,
// `ChatSession` persists it to `sessionFile` and calls the
// `onSessionIdAssigned` callback. Subsequent runs reuse the id as
// `resume`.
void test("When the fake emits the init system message with a sessionid, ChatSession per...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L76
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const observed: string[] = [];
  async function recordId(id: string) { observed.push(id); }
  const opts = { backend, systemPrompt: testPromptShort, onSessionIdAssigned: recordId, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L83
  await session.send("first message");
  await tick();

  // doctest:L86
  // Register the "done" waiter BEFORE emitting — the fake delivers
  // synchronously, so emit/handle/"done" all fire before `once()` binds.
  const done = once(session, "done");
  const run = backend.lastRun();
  assert.ok(run);
  run.emitSessionInit("sess-xyz");
  run.emitAssistantText("hi back");
  run.emitResult();
  await done;

  // doctest:L96
  t.check(session.getSessionId(), "sess-xyz");

  // doctest:L99
  t.check(observed, ["sess-xyz"]);

  // A new ChatSession in the same box picks up the persisted id:

  // doctest:L106
  const reloaded = new ChatSession(box.root, { backend, skipBootstrap: true });
  t.check(reloaded.getSessionId(), "sess-xyz");
});

// ## Custom sessionFile isolates per-thread sessions
//
// A session with a custom `sessionFile` writes its id to that file; a
// session pointed at a different `sessionFile` sees a blank slate.
void test("A session with a custom sessionFile writes its id to that file; a session poi...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L122
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const session = new ChatSession(box.root, buildSetupOpts(backend));
  await runTurn(session, { backend, sessionIdToEmit: "sess-setup-1" });

  // doctest:L127
  const raw = await readFile(box.path(SETUP_FILE), "utf-8");
  t.check(JSON.parse(raw), { sessionId: "sess-setup-1", savedAt: isoDate() });

  // Reopening with the same `sessionFile` recovers the saved id; a
  // different `sessionFile` has none:

  // doctest:L136
  const reopen = new ChatSession(box.root, buildReopenSetupOpts(backend));
  t.check(reopen.getSessionId(), "sess-setup-1");

  // doctest:L140
  const mainSession = new ChatSession(box.root, buildReopenMainOpts(backend));
  t.check(mainSession.getSessionId(), null);
});

// ## End-to-end turn: send, receive, accumulate text
//
// A full turn with an assistant text block + result event emits
// `turn-text` on completion with the accumulated assistant text.
void test("A full turn with an assistant text block + result event emits turn-text on co...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L156
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L161
  const turnTexts: string[] = [];
  session.on("turn-text", (text) => { turnTexts.push(text); });

  // doctest:L164
  await session.send("what is 2+2?");
  await tick();
  const done = once(session, "done");
  const run = backend.lastRun();
  assert.ok(run);
  run.emitSessionInit("sess-123");
  run.emitAssistantText("2+2 ");
  run.emitAssistantText("equals 4.");
  run.emitResult();
  await done;

  // doctest:L175
  t.check(turnTexts, ["2+2 equals 4."]);

  // And the backend received a user turn (one content array per send call):

  t.check(run.sent, [sentText("what is 2+2?")]);
});

// ## Close handler drains queued messages into a fresh run
//
// If the run ends while a turn is in progress and messages are queued
// behind it, the close handler auto-drains the queue into a newly
// started run. This recovers from wedged/killed sessions without losing
// the user's in-flight messages.
void test("If the run ends while a turn is in progress and messages are queued behind it...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L202
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L207
  // First message starts a turn; session goes busy
  await session.send("first");
  await tick();

  // doctest:L211
  // Two more messages queue up because busy=true
  session.enqueue("second");
  session.enqueue("third");

  // doctest:L215
  // Simulate the run ending mid-turn (no result emitted)
  const run1 = backend.lastRun();
  assert.ok(run1);
  await run1.close();
  await waitForRuns(backend, { count: 2, timeoutMs: 1000 });

  // doctest:L221
  // A second run got started and received the combined queued text
  t.check(backend.runs.map((r) => r.sent), [[sentText("first")], [sentText("second\n\nthird")]]);

});

// ## restart() closes the current run and drains queue into a fresh one
//
// Calling `restart()` ends the current run; the close handler then
// drains any queued messages into a new run, preserving the session
// id. Unlike `stop()`, queued messages survive.
void test("Calling restart() ends the current run; the close handler then drains any que...", async (t) => {
  t.teardown(async () => {
    try {
      session.stop();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L246
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L251
  await session.send("hello");
  await tick();
  session.enqueue("queued after restart");

  // doctest:L255
  session.restart();
  await waitForRuns(backend, { count: 2, timeoutMs: 1000 });

  // doctest:L258
  t.check(backend.runs.map((r) => r.sent), [[sentText("hello")], [sentText("queued after restart")]]);

});

// ## stop() clears queued messages — no auto-drain
//
// `stop()` is used for intentional shutdown (including `resetSession`).
// It clears the queue before closing the run so the close handler
// doesn't surprise the caller by starting a new run.
void test("stop() is used for intentional shutdown (including resetSession).", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L281
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
  const session = new ChatSession(box.root, opts);

  // doctest:L286
  await session.send("hi");
  await tick();
  session.enqueue("will be discarded");

  // doctest:L290
  session.stop();
  await tick();
  await tick();

  // doctest:L294
  t.check(backend.runs.map((r) => r.sent), [[sentText("hi")]]);
});

// ## Notes
//
// - All the options are optional. `new ChatSession(boxRoot)` with no
//   options still produces the pre-existing main-chat behavior.
// - Inject the fake backend for any test that exercises
//   send-to-response behavior. For tests that only care about session
//   state (getSessionId, resetSession, getHistory), no backend is
//   needed — those paths don't start a run.
// - `tick()` lets the event loop drain after pushing messages into the
//   fake. Use `once(session, "done")` to wait for a turn to complete.
// - Avoid arrow-function expressions with `=>` on the same line as other
//   code in example blocks — the doctest loader confuses the arrow with
//   its expectation marker. Put lambdas in the setup block or a helper
//   file.

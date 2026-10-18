// # Capture delivery
//
// `deliverCaptureMessage` injects the `<capture>` wrapper into a chat session,
// resolving the target (staging `targetSessionId` → most-active → a fresh session,
// never a 404) and enqueuing when the agent is busy. A fake chat backend stands in
// for the Claude subprocess so we can inspect what was sent.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox, type TmpBox } from "../../../helpers/doctest-helpers.js";
import type { ChatBackend } from "../../../../src/services/claude-chat/core.js";
import type { FakeChatBackendRun } from "../../../../src/services/claude-chat/fake.js";
import type { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createEventBus } from "../../../../src/core/event-bus/core.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { plainTestPrompt, tick } from "../../../helpers/chat-session-spawner-helpers.js";
import { appendHistory, setMostActive } from "../../../../src/core/chat/session/history.js";
import { deliverCaptureMessage, buildCaptureWrapper, resolveCaptureDeliveryTarget } from "../../../../src/core/capture/prepare/deliver.js";

const W = buildCaptureWrapper({ docPath: "tmp-capture/x.capture-session.card", imageCount: 1, audioSeconds: 7, summary: "hi" });

function makeRegistry(box: TmpBox, backend: ChatBackend) {
  return new ChatSessionRegistry(box.root, {
    backend,
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
}

// All text pushed to the backend across a run's sends.
function sentText(run: FakeChatBackendRun | null) {
  return (run?.sent ?? []).flat().map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

// ## No live/most-active session → a fresh session is created and sent to
void test("No live/most-active session → a fresh session is created and sent to", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      eventBus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L38
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  const eventBus = createEventBus(box.root);

  // doctest:L43
  const res = await deliverCaptureMessage({
    boxRoot: box.root, registry, eventBus, target: { sessionId: null, contextDir: null }, message: W,
  });
  await tick();

  // doctest:L48
  t.check(res.queued, false);

  // doctest:L51
  await t.checkText(sentText(backend.lastRun()).includes(W), "true");

  // The wrapper is composed by beebox, so the turn goes out marked client-composed.

  // doctest:L58
  t.check(backend.lastRun()?.sentClientComposed, [
    true,
  ]);
});

// ## Target chat is busy → the message is enqueued, not sent
void test("Target chat is busy → the message is enqueued, not sent", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      eventBus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  const eventBus = createEventBus(box.root);

  // doctest:L76
  // A live, busy most-active session.
  const busy = registry.getOrCreate("s-busy");
  await busy.send("first turn");
  await tick();
  await setMostActive(box.root, "s-busy");

  // doctest:L82
  // The caller resolves the target (→ the busy most-active session) first.
  const target = await resolveCaptureDeliveryTarget({ boxRoot: box.root, targetSessionId: null });
  const res = await deliverCaptureMessage({
    boxRoot: box.root, registry, eventBus, target, message: W,
  });

  // doctest:L88
  t.check(res.queued, true);

  // The wrapper did not reach the backend — only the in-flight turn's message did:

  // doctest:L95
  t.check(backend.lastRun()?.sent.length, 1);
});

// ## Explicit targetSessionId (known to the box) → delivered to it
void test("Explicit targetSessionId (known to the box) → delivered to it", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      eventBus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L108
  const box = await makeTmpBox({ git: true });
  const backend = createFakeChatBackend();
  const registry = makeRegistry(box, backend);
  const eventBus = createEventBus(box.root);

  // doctest:L113
  await appendHistory(box.root, { sessionId: "s-target" });

  // doctest:L115
  const res = await deliverCaptureMessage({
    boxRoot: box.root, registry, eventBus, target: { sessionId: "s-target", contextDir: null }, message: W,
  });
  await tick();

  // doctest:L120
  t.check(res.sessionId, "s-target");

  // doctest:L123
  await t.checkText(sentText(backend.lastRun()).includes(W), "true");
});

// ## A failed (non-busy) send throws CaptureDeliveryError
void test("A failed (non-busy) send throws CaptureDeliveryError", async (t) => {
  t.teardown(async () => {
    try {
      registry.shutdown();
      eventBus.close();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L136
  const box = await makeTmpBox({ git: true });
  const registry = makeRegistry(box, createFakeChatBackend());
  const eventBus = createEventBus(box.root);

  // doctest:L140
  // The fresh session's send is refused, as a failed non-busy send would be.
  const refuseSend = (session: ChatSession) => { session.send = async () => false; };

  // doctest:L143
  const caught = await deliverCaptureMessage({ boxRoot: box.root, registry, eventBus, wireSession: refuseSend, target: { sessionId: null, contextDir: null }, message: W }).then(() => "no throw", (e: unknown) => (e instanceof Error ? e.name : String(e)));
  t.check(caught, "CaptureDeliveryError");
});

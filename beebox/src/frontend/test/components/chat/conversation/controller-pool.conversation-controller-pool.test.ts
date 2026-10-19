// # Conversation controller ownership and startup recovery
//
// These checks use the production chat machine, replacing only its network actors
// and queued POST action. Selection and actor retention are the actual pool code.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { createActor, fromPromise, fromCallback, type EventObject, type CallbackActorLogic } from "xstate";
import { chatMachine } from "../../../../src/machines/chatMachine/machine.js";
import type { ChatEvent, ChatMachineInput } from "../../../../src/machines/chat-types.js";
import type { SessionEntry, PendingSessionEntry } from "../../../../src/api.js";
import type { ConversationTarget, SendBinding } from "../../../../../shared/chat-composer-binding.js";
import type { streamActor } from "../../../../src/machines/chatMachine/chat-actors.js";
import { ConversationControllerPool, type ChatController } from "../../../../src/components/chat/conversation/controller-pool/pool.js";
import { StartRecords } from "../../../../src/components/chat/conversation/controller-pool/start-records.js";
import { storageScopeFor } from "../../../../src/lib/storage-scope.js";
import { settleReceipt, expectReceipt } from "../../../../src/input/targets/receipts.js";

type StartTarget = Extract<ConversationTarget, { kind: "start" }>;
type SendEvent = Extract<ChatEvent, { type: "SEND" }>;
/** What the fixture records per POST: a stream input (no `type`) or a queued SEND event. */
type StreamInput = typeof streamActor extends CallbackActorLogic<EventObject, infer Input, EventObject> ? Input : never;
interface Sent extends Partial<StreamInput> { type?: string; messageId: string; binding?: SendBinding }
interface Loaded { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean; pending: PendingSessionEntry[] }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const sends: Sent[] = [];
  const actors: ChatController[] = [];
  let autoAccept = true;
  let apiBase = "/test1/api";
  const accept = (input: Sent) => { sends.push(input); if (autoAccept) settleReceipt({ disposition: "sent", emissionId: input.messageId, deduplicated: false }); };
  const factory = (input: ChatMachineInput) => {
    const empty: Loaded = { entries: [], total: 0, sessionId: input.sessionInput === "new" ? null : input.sessionInput, running: false, busy: false, pending: [] };
    const history = { entries: empty.entries, total: 0, sessionId: empty.sessionId, running: false, busy: false };
    const actor = createActor(chatMachine.provide({
      actors: { fetchInitial: fromPromise(async () => empty), fetchHistory: fromPromise(async () => history), stream: fromCallback<EventObject, StreamInput>(({ input: streamInput }) => accept(streamInput)) },
      actions: { queueSend: ({ event }) => { if (event.type === "SEND") accept(event); } },
    }), { input });
    actors.push(actor);
    return actor;
  };
  const options = { storage, createController: factory, getApiBase: () => apiBase };
  return { pool: new ConversationControllerPool("test1", options), options, storage, sends, actors, holdReceipts: () => { autoAccept = false; }, acceptReceipts: () => { autoAccept = true; }, switchBox: () => { apiBase = "/test2/api"; } };
}
const session = (sessionId: string): ConversationTarget => ({ kind: "session", sessionId, contextDir: "_content" });
const start: StartTarget = { kind: "start", clientConversationId: "logical-new", contextDir: "_content", engine: "codex" };
const bind = (target: ConversationTarget): SendBinding => ({ boxSlug: "test1", target, attention: { surface: "card", focusedRef: "/_content/report.md", transcript: "hidden" } });
const send = (messageId: string): SendEvent => ({ type: "SEND", messageId, message: "test" });
/** The session id a recorded POST was bound to, if it was bound to a session. */
const boundSession = (sent: Sent | undefined) => (sent?.binding?.target.kind === "session" ? sent.binding.target.sessionId : undefined);

// ## Startup recovery is isolated by API base when worktrees share a box slug
//
// Two worktrees live under one browser origin during development. Their frozen
// API bases must produce separate startup records even though both boxes are
// named `test1`; production keeps the historical `test1` scope.
void test("Two worktrees live under one browser origin during development.", async (t) => {
  // doctest:L61
  const f = fixture();
  const paperTarget = { ...start, clientConversationId: "paper-start" };
  const chatTarget = { ...start, clientConversationId: "chat-start" };
  const paper = new ConversationControllerPool("test1", { ...f.options, getApiBase: () => "/paper-cards/test1/api" });
  const chat = new ConversationControllerPool("test1", { ...f.options, getApiBase: () => "/chat-everywhere/test1/api" });
  paper.select(paperTarget);
  chat.select(chatTarget);
  await tick();
  const paperSend = paper.capture(bind(paperTarget));
  paperSend.send(send("paper-message"));
  await paperSend.finished();
  const chatSend = chat.capture(bind(chatTarget));
  chatSend.send(send("chat-message"));
  await chatSend.finished();
  const paperRecords = new StartRecords(f.storage, paper.storageScope);
  const chatRecords = new StartRecords(f.storage, chat.storageScope);
  const isolated = {
    scopes: [paper.storageScope, chat.storageScope, storageScopeFor("/test1/api")],
    paper: [paperRecords.get("paper-start")?.firstEmissionId, paperRecords.get("chat-start")],
    chat: [chatRecords.get("chat-start")?.firstEmissionId, chatRecords.get("paper-start")],
  };
  paper.suspend();
  chat.suspend();
  t.check(isolated, {
    scopes: [
      "paper-cards/test1",
      "chat-everywhere/test1",
      "test1",
    ],
    paper: [
      "paper-message",
      undefined,
    ],
    chat: [
      "chat-message",
      undefined,
    ],
  });
});

// ## A captured send survives navigation and inactive actors are released
void test("A captured send survives navigation and inactive actors are released", async (t) => {
  // doctest:L91
  const f = fixture();
  const first = f.pool.select(session("first"));
  await tick();
  const captured = f.pool.capture(bind(session("first")));
  f.pool.select(session("second"));
  await tick();
  captured.send(send("captured"));
  await captured.finished();
  const result = { destination: boundSession(f.sends[0]), original: first.getSnapshot().status, actors: f.actors.map((actor) => actor.getSnapshot().status) };
  f.pool.suspend();
  t.check(result, {
    destination: "first",
    original: "active",
    actors: [
      "active",
      "active",
    ],
  });
});

// ## An unrelated assignment cannot release a fresh conversation's follow-up
void test("An unrelated assignment cannot release a fresh conversation's follow-up", async (t) => {
  // doctest:L108
  const f = fixture();
  const first = f.pool.select(start);
  await tick();
  const initial = f.pool.capture(bind(start));
  initial.send(send("first-start"));
  await initial.finished();
  const followup = f.pool.capture(bind(start));
  followup.send(send("followup"));
  f.pool.markReady("unrelated");
  await tick();
  const held = [...f.sends];
  f.pool.markReady("real-id"); // bus can arrive before the owning stream's init
  first.send({ type: "SESSION_ASSIGNED", sessionId: "real-id" });
  await followup.finished();
  const records = new StartRecords(f.storage, "test1");
  f.pool.suspend();
  t.check({ held, destination: boundSession(f.sends[1]), state: records.get("logical-new")?.state }, {
    held: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "first-start",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
    destination: "real-id",
    state: "assigned",
  });
});

// ## Reload never turns a follow-up into a second fresh start
void test("Reload never turns a follow-up into a second fresh start", async (t) => {
  // doctest:L131
  const f = fixture();
  f.pool.select(start);
  await tick();
  const initial = f.pool.capture(bind(start));
  initial.send(send("accepted-first"));
  await initial.finished();
  f.pool.suspend();
  const restored = new ConversationControllerPool("test1", f.options);
  restored.select(start);
  await tick();
  const receipt = expectReceipt("after-reload");
  const followup = restored.capture(bind(start));
  followup.send(send("after-reload"));
  await followup.finished();
  restored.suspend();
  t.check({ freshSends: f.sends, disposition: (await receipt).disposition }, {
    freshSends: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "accepted-first",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
    disposition: "rejected",
  });
});

// ## A box switch after upload capture cannot send through the new API prefix
void test("A box switch after upload capture cannot send through the new API prefix", async (t) => {
  // doctest:L153
  const f = fixture();
  f.pool.select(session("first"));
  await tick();
  const captured = f.pool.capture(bind(session("first")));
  f.switchBox();
  const receipt = expectReceipt("wrong-box");
  captured.send(send("wrong-box"));
  await captured.finished();
  f.pool.suspend();
  t.check({ sends: f.sends, disposition: (await receipt).disposition }, {
    sends: [],
    disposition: "rejected",
  });
});

// ## Corrupted startup metadata fails closed
void test("Corrupted startup metadata fails closed", async (t) => {
  // doctest:L169
  let message = "";
  try {
    new StartRecords({ getItem: () => "{broken", setItem: () => {} }, "test1");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  };
  t.check(message, "Conversation startup records need recovery");
});

// ## A first send during loading waits for the owning stream
void test("A first send during loading waits for the owning stream", async (t) => {
  // doctest:L182
  const f = fixture();
  const actor = f.pool.select(start);
  const captured = f.pool.capture(bind(start));
  captured.send(send("early-first"));
  await captured.finished();
  const result = { state: actor.getSnapshot().value, sends: f.sends };
  f.pool.suspend();
  t.check(result, {
    state: "streaming",
    sends: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "early-first",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
  });
});

// ## Two starts only adopt their own stream identities
void test("Two starts only adopt their own stream identities", async (t) => {
  // doctest:L196
  const f = fixture();
  const other = { ...start, clientConversationId: "other-start" };
  const first = f.pool.select(start);
  await tick();
  const firstSend = f.pool.capture(bind(start));
  firstSend.send(send("one"));
  await firstSend.finished();
  const second = f.pool.select(other);
  await tick();
  const secondSend = f.pool.capture(bind(other));
  secondSend.send(send("two"));
  await secondSend.finished();
  const assigned: Array<[string, string | undefined]> = [];
  f.pool.setAssignmentHandler((id, target) => assigned.push([id, target?.clientConversationId]));
  f.pool.markReady("real-two");
  second.send({ type: "SESSION_ASSIGNED", sessionId: "real-two" });
  f.pool.markReady("real-one");
  first.send({ type: "SESSION_ASSIGNED", sessionId: "real-one" });
  f.pool.suspend();
  t.check(assigned, [
    [
      "real-two",
      "other-start",
    ],
    [
      "real-one",
      "logical-new",
    ],
  ]);
});

// ## Suspension releases a locally held follow-up without dispatch
void test("Suspension releases a locally held follow-up without dispatch", async (t) => {
  // doctest:L222
  const f = fixture();
  f.pool.select(start);
  await tick();
  const firstSend = f.pool.capture(bind(start));
  firstSend.send(send("before-suspend"));
  await firstSend.finished();
  const receipt = expectReceipt("held-suspend");
  const held = f.pool.capture(bind(start));
  held.send(send("held-suspend"));
  f.pool.suspend();
  await held.finished();
  t.check({ starts: f.sends, disposition: (await receipt).disposition }, {
    starts: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "before-suspend",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
    disposition: "rejected",
  });
});

// ## Metadata failures preserve acceptance and don't crash assignment observers
void test("Metadata failures preserve acceptance and don't crash assignment observers", async (t) => {
  // doctest:L240
  const f = fixture();
  const originalWrite = f.storage.setItem;
  let writes = 0;
  f.storage.setItem = (key, value) => {
    writes++;
    if (writes > 1) throw new Error("disk full");
    originalWrite(key, value);
  };
  const notices: string[] = [];
  f.pool.setRecoveryHandler((notice) => { if (notice !== null) notices.push(notice); });
  const actor = f.pool.select(start);
  await tick();
  const receipt = expectReceipt("accepted-storage-failed");
  const captured = f.pool.capture(bind(start));
  captured.send(send("accepted-storage-failed"));
  await captured.finished();
  f.pool.markReady("ready-but-not-saved");
  actor.send({ type: "SESSION_ASSIGNED", sessionId: "ready-but-not-saved" });
  const result = { disposition: (await receipt).disposition, notices, active: actor.getSnapshot().status };
  f.pool.suspend();
  t.check(result, {
    disposition: "sent",
    notices: [
      "Message accepted; startup association could not be saved. Open the conversation before reloading.",
      "Message accepted; startup association could not be saved. Open the conversation before reloading.",
    ],
    active: "active",
  });
});

// ## Storage failure before dispatch never submits the fresh start
void test("Storage failure before dispatch never submits the fresh start", async (t) => {
  // doctest:L267
  const f = fixture();
  f.storage.setItem = () => { throw new Error("storage blocked"); };
  f.pool.select(start);
  await tick();
  const receipt = expectReceipt("no-attempt-record");
  const captured = f.pool.capture(bind(start));
  captured.send(send("no-attempt-record"));
  await captured.finished();
  f.pool.suspend();
  t.check({ sends: f.sends, disposition: (await receipt).disposition }, {
    sends: [],
    disposition: "rejected",
  });
});

// ## Effect replay preserves actors; real detach stops them
void test("Effect replay preserves actors; real detach stops them", async (t) => {
  // doctest:L283
  const f = fixture();
  const actor = f.pool.select(session("first"));
  await tick();
  const detach = f.pool.attach();
  detach();
  const finalDetach = f.pool.attach();
  await tick();
  t.check(f.pool.controller(session("first")), is(actor));
  const replayStatus = actor.getSnapshot().status;
  finalDetach();
  await tick();
  t.check({ replayStatus, afterUnmount: actor.getSnapshot().status }, {
    replayStatus: "active",
    afterUnmount: "stopped",
  });
});

// ## A definitively refused first send is retryable and releases held follow-ups
void test("A definitively refused first send is retryable and releases held follow-ups", async (t) => {
  // doctest:L300
  const f = fixture();
  f.holdReceipts();
  const actor = f.pool.select(start);
  await tick();
  const first = f.pool.capture(bind(start));
  first.send(send("refused-first"));
  await tick();
  const waitingReceipt = expectReceipt("waiting-followup");
  const waiting = f.pool.capture(bind(start));
  waiting.send(send("waiting-followup"));
  settleReceipt({ disposition: "rejected", emissionId: "refused-first", reason: "invalid model", definitive: true });
  actor.send({ type: "STREAM_FAILED", error: "invalid model", accepted: false });
  await first.finished();
  await waiting.finished();
  const saved = new StartRecords(f.storage, "test1").get("logical-new");
  assert.ok(saved);
  f.acceptReceipts();
  const retry = f.pool.capture(bind(start));
  retry.send(send("refused-first"));
  await retry.finished();
  const result = { stateAfterRefusal: saved.state, firstID: saved.firstEmissionId, heldDisposition: (await waitingReceipt).disposition,
    postedIDs: f.sends.map((entry) => entry.messageId) };
  f.pool.suspend();
  t.check(result, {
    stateAfterRefusal: "prepared",
    firstID: "refused-first",
    heldDisposition: "rejected",
    postedIDs: [
      "refused-first",
      "refused-first",
    ],
  });
});

// ## Uncertain rejection releases waiters but keeps restart recovery-only
void test("Uncertain rejection releases waiters but keeps restart recovery-only", async (t) => {
  // doctest:L330
  const f = fixture();
  f.holdReceipts();
  const actor = f.pool.select(start);
  await tick();
  const first = f.pool.capture(bind(start));
  first.send(send("uncertain-first"));
  await tick();
  const waitingReceipt = expectReceipt("uncertain-followup");
  const waiting = f.pool.capture(bind(start));
  waiting.send(send("uncertain-followup"));
  settleReceipt({ disposition: "rejected", emissionId: "uncertain-first", reason: "network response lost" });
  actor.send({ type: "STREAM_FAILED", error: "network response lost", accepted: false });
  await first.finished();
  await waiting.finished();
  const saved = new StartRecords(f.storage, "test1").get("logical-new");
  assert.ok(saved);
  f.pool.suspend();
  t.check({ state: saved.state, posted: f.sends, heldDisposition: (await waitingReceipt).disposition }, {
    state: "attempted",
    posted: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "uncertain-first",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
    heldDisposition: "rejected",
  });
});

// ## Restore and edit may start again, but a pre-refusal capture cannot
void test("Restore and edit may start again, but a pre-refusal capture cannot", async (t) => {
  // doctest:L354
  const f = fixture();
  f.holdReceipts();
  const actor = f.pool.select(start);
  await tick();
  const first = f.pool.capture(bind(start));
  first.send(send("replace-first"));
  await tick();
  const delayed = f.pool.capture(bind(start)); // attachments still preparing
  settleReceipt({ disposition: "rejected", emissionId: "replace-first", reason: "invalid request", definitive: true });
  actor.send({ type: "STREAM_FAILED", error: "invalid request", accepted: false });
  await first.finished();
  const delayedReceipt = expectReceipt("replace-delayed");
  delayed.send(send("replace-delayed"));
  await delayed.finished();
  f.acceptReceipts();
  const edited = f.pool.capture(bind(start)); // a new gesture after Restore/edit
  edited.send(send("replace-edited"));
  await edited.finished();
  const record = new StartRecords(f.storage, "test1").get("logical-new");
  assert.ok(record);
  const result = { refusedDelayed: (await delayedReceipt).disposition, firstID: record.firstEmissionId, postedIDs: f.sends.map((entry) => entry.messageId) };
  f.pool.suspend();
  t.check(result, {
    refusedDelayed: "rejected",
    firstID: "replace-edited",
    postedIDs: [
      "replace-first",
      "replace-edited",
    ],
  });
});

// ## Accepted startup without init has a bounded visible wait and releases its actor
void test("Accepted startup without init has a bounded visible wait and releases its actor", async (t) => {
  // doctest:L383
  const f = fixture();
  f.pool.suspend();
  const pool = new ConversationControllerPool("test1", { ...f.options, aliasWaitMs: 50 });
  const actor = pool.select(start);
  await tick();
  const first = pool.capture(bind(start));
  first.send(send("no-init-first"));
  await first.finished();
  const receipt = expectReceipt("no-init-followup");
  const waiting = pool.capture(bind(start));
  waiting.send(send("no-init-followup"));
  actor.send({ type: "STREAM_FAILED", error: "engine crashed", accepted: true });
  await waiting.finished();
  const record = new StartRecords(f.storage, "test1").get("logical-new");
  assert.ok(record);
  // Release the selection; the uncertain alias wait itself must not pin this actor.
  pool.select(session("elsewhere"));
  await tick();
  const result = { disposition: (await receipt).disposition, state: record.state, firstID: record.firstEmissionId, posted: f.sends, actor: actor.getSnapshot().status };
  pool.suspend();
  t.check(result, {
    disposition: "rejected",
    state: "accepted",
    firstID: "no-init-first",
    posted: [
      {
        sessionInput: "new",
        message: "test",
        messageId: "no-init-first",
        contextDir: "_content",
        engine: "codex",
        startup: false,
        binding: {
          boxSlug: "test1",
          target: {
            kind: "start",
            clientConversationId: "logical-new",
            contextDir: "_content",
            engine: "codex",
          },
          attention: {
            surface: "card",
            focusedRef: "/_content/report.md",
            transcript: "hidden",
          },
        },
      },
    ],
    actor: "stopped",
  });
});

// # Quick chat submit, choose, discard, and home
//
// `quickChat.submit` stores, routes, and delivers one thought in one request.
// When the box is not sure where it goes, or cannot judge it at all, the thought
// is stored as `needs-choice` and the person picks with `quickChat.choose`.
// Nothing is lost when a step fails: the record holds the message, and a repeat
// `submit` with the same id finishes the job (docs/plans/box-screen.md, track 1).
//
// These doctests use a synthetic box, the fake Jev service, and a scripted chat
// runtime. The runtime stands in for the send route's target resolution and its
// sender: it claims each message id the way `send-dedup.ts` does, so a second
// delivery of one id is answered as a duplicate.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str, uuid } from "agent-doctest/check";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import { setChatRuntime, clearChatRuntime, type ChatRuntime, type SendOutcome, type SendTargetArgs, type SendTargetResult, type UserMessageSendArgs } from "../../../../src/webapp/chat-runtime.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import type { ReserveResult } from "../../../../src/core/chat/session/reserve.js";
import { ChatScheduleManager } from "../../../../src/core/chat/schedules/core.js";
import type { ChatChannel } from "../../../../src/shared/chat-channel.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { quickChatRouter } from "../../../../src/webapp/trpc/routers/quick-chat.js";
import { createFakeJev, type JevService } from "../../../../src/services/jev.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

function caller(boxRoot: string, jev?: JevService) {
  const ctx: TrpcContext = trpcContext({
    boxRoot,
    authed: true,
    isAuthenticatedOwner: true,
    services: { jev },
    user: { email: "ari@example.com", name: "Ari" },
  });
  return quickChatRouter.createCaller(ctx);
}

type SubmitInput = Parameters<ReturnType<typeof caller>["submit"]>[0];

type View = Awaited<ReturnType<ReturnType<typeof caller>["submit"]>>;

/** Client JSON the declared input type forbids, as an untrusted client could send it; the server's own validation is what must refuse it. */
function untrusted(value: object): SubmitInput {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A chat runtime scripted at the two seams quick chat uses. `resolve` answers
 * target resolution; `send` answers a send that claimed its id. Ids are claimed
 * on acceptance, as the durable claim is.
 */
function scriptedRuntime(
  boxRoot: string,
  script?: {
    reserve?: "reserved" | "taken" | "unsupported";
    resolve?: (args: SendTargetArgs) => SendTargetResult;
    send?: (args: UserMessageSendArgs) => SendOutcome;
  },
) {
  const log: {
    reservations: Parameters<ChatSessionRegistry["reserve"]>[0][];
    targets: SendTargetArgs[];
    sends: Array<{ message: string; user: string | null; channel: ChatChannel | null }>;
  } = { reservations: [], targets: [], sends: [] };
  const claimed = new Set<string | undefined>();
  // Quick chat reads only registry.reserve, resolveSendTarget and sendUserMessage.
  // The class-typed parts are prototype-backed objects: they carry the class type without running its constructor.
  const registry = Object.assign(Object.create(ChatSessionRegistry.prototype), {
    reserve: async (input: Parameters<ChatSessionRegistry["reserve"]>[0]): Promise<ReserveResult> => {
      log.reservations.push(input);
      const kind = script?.reserve ?? "reserved";
      return kind === "reserved" ? { kind, sessionId: input.sessionId } : { kind };
    },
  });
  const session = Object.create(ChatSession.prototype);
  const runtime: ChatRuntime = {
    registry,
    scheduleManager: Object.create(ChatScheduleManager.prototype),
    wireSession: () => {},
    maintenance: Promise.resolve(),
    resolveSendTarget: async (args: SendTargetArgs): Promise<SendTargetResult> => {
      log.targets.push(args);
      return script?.resolve?.(args) ?? { ok: true, target: { session, id: args.sessionParam === "new" ? null : args.sessionParam } };
    },
    sendUserMessage: async (args: UserMessageSendArgs): Promise<SendOutcome> => {
      log.sends.push({ message: args.message, user: args.user?.email ?? null, channel: args.channel ?? null });
      if (claimed.has(args.messageId)) return { status: 200, body: { deduplicated: true } };
      claimed.add(args.messageId);
      return script?.send?.(args) ?? { status: 200, body: { turnId: "turn-1" } };
    },
  };
  setChatRuntime(boxRoot, runtime);
  return log;
}

async function failure(run: () => Promise<unknown>) {
  try { await run(); return "unexpected success"; }
  catch (error) { return error instanceof TRPCError ? `${error.code}: ${error.message}` : String(error); }
}

/** A box with one resumable chat at the root and a Garden landmark. Candidates: c0 the chat, c1 a new chat in Garden, c2 a new general chat. */
async function gardenBox() {
  const box = await makeTmpBox();
    const sessionId = randomUUID();
  const log = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(log), { recursive: true });
  await writeFile(log, JSON.stringify({ type: "user", uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Plan the week" }] } }) + "\n");
  await box.write(`_content/chat/web/2026-09-21_${sessionId}.chat.card`, `---\nsession: ${sessionId}\n---\n\n`);
  await box.write("_content/Garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  return { box, sessionId };
}

function judged(probabilities: Record<string, number>) {
  return createFakeJev({ result: { model: "synthetic-jev", probabilities, confidence: Math.max(...Object.values(probabilities)) } });
}

/** A view without the parts every example repeats. */
function face(view: View) {
  const { id: _id, message: _message, createdAt: _createdAt, ...rest } = view;
  return rest;
}

// ## A clear thought posts at once
//
// When the selected place holds at least 0.9 of the judgment, `submit` delivers
// in the same request. The message goes through the sender framed as a typed
// message with `source="box-screen"`, attributed to the caller, with the record id as its message id and the
// caller's channel. The view names the chat; the probabilities stay on disk.
void test("When the selected place holds at least 0.9 of the judgment, submit delivers i...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L129
  const { box, sessionId } = await gardenBox();
  const runtime = scriptedRuntime(box.root);
  const fake = judged({ c0: 0.95, c1: 0.03, c2: 0.02 });
  const api = caller(box.root, fake);
  const request: SubmitInput = { id: randomUUID(), message: "Book the plumber for Tuesday", channel: "ios-native" };
  const sent = await api.submit(request);
  t.check([face(sent), sent.destination?.sessionId === sessionId, runtime.sends], [
    {
      state: "sent",
      destination: {
        label: "“Plan the week”",
        sessionId: str`${any(String)}`,
      },
    },
    true,
    [
      {
        message: "<typed source=\"box-screen\">Book the plumber for Tuesday</typed>",
        user: "ari@example.com",
        channel: "ios-native",
      },
    ],
  ]);

  // A repeat of the same request, after a lost response, returns the stored record.
  // It does not ask Jev again or send again. Different text under the same id is
  // refused.

  // doctest:L148
  const again = await api.submit(request);
  t.check([again.state, fake.calls.length, runtime.sends.length], [
    "sent",
    1,
    1,
  ]);

  // doctest:L152
  t.check(await failure(() => api.submit({ ...request, message: "Something else" })), "CONFLICT: This send already has different text. Start another message.");

  // Two callers submitting the same id at once take the record lock in turn: one
  // judgment, one delivery.

  // doctest:L160
  const twice = { id: randomUUID(), message: "Water the tomatoes" };
  const [one, two] = await Promise.all([api.submit(twice), api.submit(twice)]);
  t.check([one.state, two.state, fake.calls.length, runtime.sends.length], [
    "sent",
    "sent",
    2,
    2,
  ]);

  // A busy chat queues the message; the view says so.

  // doctest:L169
  scriptedRuntime(box.root, { send: () => ({ status: 200, body: { queued: true } }) });
  t.check(face(await api.submit({ id: randomUUID(), message: "Also the faucet" })), {
    state: "sent",
    destination: {
      label: "“Plan the week”",
      sessionId: str`${any(String)}`,
    },
    queued: true,
  });
});

// ## An uncertain thought waits for the person
//
// Below the floor, `submit` stores the thought and offers the three likeliest
// destinations plus a new general chat. Nothing is sent. `choose` fixes one of
// the offered destinations and delivers; a new chat is reserved first, so the
// record names its session before delivery starts.
void test("Below the floor, submit stores the thought and offers the three likeliest des...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L187
  const { box } = await gardenBox();
  const runtime = scriptedRuntime(box.root);
  const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
  const unsure = await api.submit({ id: randomUUID(), message: "What should I plant next to the tomatoes" });
  t.check([face(unsure), runtime.sends.length], [
    {
      state: "needs-choice",
      reason: "uncertain",
      choices: [
        {
          candidateId: "c0",
          label: "“Plan the week”",
        },
        {
          candidateId: "c1",
          label: "New chat in Garden",
        },
        {
          candidateId: "c2",
          label: "New general chat",
        },
      ],
    },
    0,
  ]);

  // A candidate the record did not offer is refused. The chosen one is delivered.
  // A second `choose` on the sent record returns it unchanged.

  // doctest:L209
  t.check(await failure(() => api.choose({ id: unsure.id, candidateId: "c9" })), "BAD_REQUEST: Choose one of the offered destinations.");

  // doctest:L212
  const chosen = await api.choose({ id: unsure.id, candidateId: "c1", channel: "web-mobile" });
  const reserved = runtime.reservations[0];
  assert.ok(reserved && chosen.destination);
  t.check([face(chosen), chosen.destination.sessionId === reserved.sessionId, reserved.contextDir, runtime.sends.map((send) => send.channel)], [
    {
      state: "sent",
      destination: {
        label: "New chat in Garden",
        sessionId: str`${uuid()}`,
      },
    },
    true,
    "_content/Garden",
    [
      "web-mobile",
    ],
  ]);

  // doctest:L218
  t.check((await api.choose({ id: unsure.id, candidateId: "c0" })).destination?.label, "New chat in Garden");

  // doctest:L221
  t.check(await failure(() => api.choose({ id: randomUUID(), candidateId: "c0" })), "NOT_FOUND: This message is no longer stored.");
});

// ## Voice, typed, and external thoughts retain their input source
//
// `origin` says how the thought was entered. A `voice` thought is delivered as
// `<speech source="box-screen" stt="live">` — it is the phone's live transcript,
// since no recording reaches the box for an HQ pass — and a `typed` one as
// `<typed source="box-screen">`. An external input requires a source and is framed
// as `<external-input source="…">`.
// A client built before `origin` existed sends none, and its thought is typed.
// The record keeps the origin, so a thought that waited for the person's choice
// is delivered by `choose` in the same wrapper.
void test("origin says how the thought was entered.", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L242
  const { box } = await gardenBox();
  const runtime = scriptedRuntime(box.root);
  const sure = caller(box.root, judged({ c0: 0.95, c1: 0.03, c2: 0.02 }));
  await sure.submit({ id: randomUUID(), message: "Call the plumber", origin: "voice" });
  await sure.submit({ id: randomUUID(), message: "Buy stamps" });
  const unsure = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
  const waiting = await unsure.submit({ id: randomUUID(), message: "Something about the beds", origin: "voice" });
  await unsure.choose({ id: waiting.id, candidateId: "c1" });
  const external = await unsure.submit({ id: randomUUID(), message: "Renew my passport", origin: "external", source: "apple-app-intents" });
  await unsure.choose({ id: external.id, candidateId: "c1" });
  const retriedExternal = await unsure.submit({ id: external.id, message: external.message });
  t.check(runtime.sends.map((send) => send.message), [
    "<speech source=\"box-screen\" stt=\"live\">Call the plumber</speech>",
    "<typed source=\"box-screen\">Buy stamps</typed>",
    "<speech source=\"box-screen\" stt=\"live\">Something about the beds</speech>",
    "<external-input source=\"apple-app-intents\">Renew my passport</external-input>",
  ]);

  // doctest:L260
  t.check(retriedExternal.state, "sent");

  // An origin outside the supported inputs is refused.

  // doctest:L267
  await t.checkText(await failure(() => sure.submit(untrusted({ id: randomUUID(), message: "Hum", origin: "video" }))), "«BAD_REQUEST: *»");
});

// ## A voice thought the phone ran HQ on
//
// When the phone ran its own HQ pass (docs/plans/ios-quick-chat-hq.md), it sends
// `hqService`, and the thought is framed with `stt-service` instead of
// `stt="live"`. The record keeps it through a choice and a repeated submit.
void test("When the phone ran its own HQ pass (docs/plans/ios-quick-chat-hq.md), it send...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L283
  const { box } = await gardenBox();
  const runtime = scriptedRuntime(box.root);
  const sure = caller(box.root, judged({ c0: 0.95, c1: 0.03, c2: 0.02 }));
  await sure.submit({ id: randomUUID(), message: "Call Odette about the 14th", origin: "voice", hqService: "apple-speech-transcriber" });
  const unsure = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
  const waitingId = randomUUID();
  const waiting = await unsure.submit({ id: waitingId, message: "Something about the beds", origin: "voice", hqService: "apple-speech-transcriber" });
  await unsure.submit({ id: waitingId, message: "Something about the beds", origin: "voice" });
  await unsure.choose({ id: waiting.id, candidateId: "c1" });
  t.check(runtime.sends.map((send) => send.message), [
    "<speech source=\"box-screen\" stt-service=\"apple-speech-transcriber\">Call Odette about the 14th</speech>",
    "<speech source=\"box-screen\" stt-service=\"apple-speech-transcriber\">Something about the beds</speech>",
  ]);

  // `hqService` belongs only to a voice thought, and must be a short token: it is
  // framed into a wrapper attribute.

  // doctest:L303
  await t.checkText(await failure(() => sure.submit({ id: randomUUID(), message: "Buy stamps", origin: "typed", hqService: "apple-speech-transcriber" })), "«BAD_REQUEST: *»");

  // doctest:L306
  await t.checkText(await failure(() => sure.submit({ id: randomUUID(), message: "Hi", origin: "voice", hqService: "x\" onload=\"y" })), "«BAD_REQUEST: *»");
});

// ## "New chat" is honored over the existing-chat preference
//
// The box's existing root chat and the new general chat share the root. Jev
// leans slightly to the new chat; the existing-chat preference sends the thought
// to the existing chat. A thought that opens with "new chat" skips that
// preference, and goes to a new chat.
void test("The box's existing root chat and the new general chat share the root.", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L323
  const { box, sessionId } = await gardenBox();
  const runtime = scriptedRuntime(box.root);
  const api = caller(box.root, judged({ c0: 0.45, c1: 0.05, c2: 0.5 }));
  const plain = await api.submit({ id: randomUUID(), message: "Plan the dinner" });
  const fresh = await api.submit({ id: randomUUID(), message: "New chat: plan the dinner" });
  const reserved = runtime.reservations[0];
  assert.ok(plain.destination && fresh.destination && reserved);
  t.check([[plain.destination.label, plain.destination.sessionId === sessionId], [fresh.destination.label, fresh.destination.sessionId === reserved.sessionId]], [
    [
      "“Plan the week”",
      true,
    ],
    [
      "New general chat",
      true,
    ],
  ]);
});

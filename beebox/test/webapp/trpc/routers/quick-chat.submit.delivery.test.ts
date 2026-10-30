// # Quick chat submit: delivery, discard, and home
//
// Continues [quick-chat.submit.test.ts](quick-chat.submit.test.ts). This part covers thoughts kept when routing cannot run, finishing an interrupted delivery on the next submit, a missing destination, new chats without a session id, discarding a stored thought, and the home screen's recent chats.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str, uuid } from "@ianbicking/tap-check/check";
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
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
import { JevError } from "../../../../src/services/jev-wire.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { containedSessionCwd, getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

function callerFor(boxRoot: string, options: { authed: boolean; jev?: JevService | undefined }) {
  const ctx: TrpcContext = trpcContext({
    boxRoot,
    authed: options.authed,
    isAuthenticatedOwner: true,
    services: { jev: options.jev },
    user: { email: "ari@example.com", name: "Ari" },
  });
  return quickChatRouter.createCaller(ctx);
}

function caller(boxRoot: string, jev?: JevService) {
  return callerFor(boxRoot, { authed: true, jev });
}

type SubmitInput = Parameters<ReturnType<typeof caller>["submit"]>[0];

type View = Awaited<ReturnType<ReturnType<typeof caller>["submit"]>>;

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

/** Run with console.warn and console.error captured: the degradations these examples cause are logged by design. */
async function capturingLogs<T>(run: () => Promise<T>) {
  const lines: string[] = [];
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => { lines.push(`warn ${args.map(String).join(" ")}`); };
  console.error = (...args: unknown[]) => { lines.push(`error ${args.map(String).join(" ")}`); };
  try { return { result: await run(), lines }; }
  finally { console.warn = warn; console.error = error; }
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

// ## Routing that cannot run still keeps the thought
//
// With no OpenRouter key and no injected service, or when Jev fails or answers
// badly, the thought is stored with `reason: "routing-unavailable"`. Its choices
// are the recent chats and a new general chat, built without Jev.
void test("With no OpenRouter key and no injected service, or when Jev fails or answers...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box } = await gardenBox();
  scriptedRuntime(box.root);
  const reasons: Array<ReturnType<typeof face>> = [];
  const { lines } = await capturingLogs(async () => {
    for (const jev of [undefined, createFakeJev({ error: new JevError("timeout", "request") }), createFakeJev({ error: new JevError("distribution keys did not match", "response") })]) {
      const view = await caller(box.root, jev).submit({ id: randomUUID(), message: "Remind me about the passport" });
      reasons.push(face(view));
    }
  });
  t.check(reasons, [
    {
      state: "needs-choice",
      reason: "routing-unavailable",
      choices: [
        {
          candidateId: "c0",
          label: "“Plan the week”",
        },
        {
          candidateId: "c2",
          label: "New general chat",
        },
      ],
    },
    {
      state: "needs-choice",
      reason: "routing-unavailable",
      choices: [
        {
          candidateId: "c0",
          label: "“Plan the week”",
        },
        {
          candidateId: "c2",
          label: "New general chat",
        },
      ],
    },
    {
      state: "needs-choice",
      reason: "routing-unavailable",
      choices: [
        {
          candidateId: "c0",
          label: "“Plan the week”",
        },
        {
          candidateId: "c2",
          label: "New general chat",
        },
      ],
    },
  ]);

  t.check(lines, [
    str`warn [quick-chat] routing judgment failed for ${uuid()}: Jev request error: timeout`,
    str`warn [quick-chat] routing judgment failed for ${uuid()}: Jev response error: distribution keys did not match`,
  ]);

  // When the catalog itself cannot be built, here an invalid rubric, the only
  // choice is a new general chat, and choosing it delivers.

  await box.write("_config/chat-routing.yaml", "destinations: not-a-list\n");
  const fake = judged({ c0: 1 });
  const api = caller(box.root, fake);
  const { result: stuck, lines: catalogLines } = await capturingLogs(() => api.submit({ id: randomUUID(), message: "Call the vet" }));
  t.check(fake.calls, []);
  t.check([face(stuck), catalogLines], [
    {
      state: "needs-choice",
      reason: "routing-unavailable",
      choices: [
        {
          candidateId: "general",
          label: "New general chat",
        },
      ],
    },
    [
      str`warn [quick-chat] routing catalog unavailable for ${uuid()}: Chat routing rubric is invalid. Check _config/chat-routing.yaml.`,
    ],
  ]);

  t.check(face(await api.choose({ id: stuck.id, candidateId: "general" })), {
    state: "sent",
    destination: {
      label: "New general chat",
      sessionId: str`${uuid()}`,
    },
  });
});

// ## A delivery that did not finish is finished by the next submit
//
// If the server stops after writing `sending` and before delivering, the record
// stays in `open/` with its destination fixed. Here the chat runtime is not
// running at the first submit. `home` lists the record as unfinished, and a repeat
// `submit` delivers it without asking Jev again.
void test("If the server stops after writing sending and before delivering, the record s...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box } = await gardenBox();
  const fake = judged({ c0: 0.95, c1: 0.03, c2: 0.02 });
  const api = caller(box.root, fake);
  const request: SubmitInput = { id: randomUUID(), message: "Renew the car registration", origin: "external", source: "apple-app-intents" };
  t.check(face(await api.submit(request)), {
    state: "sending",
    destination: {
      label: "“Plan the week”",
      sessionId: str`${any(String)}`,
    },
    lastError: "Chat is not running on the box. Retry in a moment.",
  });

  t.check((await api.home()).open.map((view) => view.state), [
    "sending",
  ]);

  const runtime = scriptedRuntime(box.root);
  const resent = await api.submit({ id: request.id, message: request.message });
  t.check(face(resent), {
    state: "sent",
    destination: {
      label: "“Plan the week”",
      sessionId: str`${uuid()}`,
    },
  });
  t.check(fake.calls, [
    {
      state: {
        message: "Renew the car registration",
        candidates: [
          {
            id: "c0",
            label: "“Plan the week”",
            target: { kind: "existing-session", sessionId: uuid(), contextDir: "" },
            lastActivity: isoDate(),
            recentContext: str`[${isoDate()}] user: Plan the week`,
            contextTruncated: false,
            totalEntries: 1,
            lastMessageAt: isoDate(),
          },
          {
            id: "c1",
            label: "New chat in Garden",
            target: { kind: "new-session", contextDir: "_content/Garden" },
            landmark: { path: "_content/Garden/Garden.landmark.card", label: "Garden" },
          },
          {
            id: "c2",
            label: "New general chat",
            target: { kind: "new-session", contextDir: "" },
          },
        ],
      },
      criteria: {
        c0: "“Plan the week”: existing-session. Use the matching candidate in state for its context and rubric.",
        c1: "New chat in Garden: new-session. Use the matching candidate in state for its context and rubric.",
        c2: "New general chat: new-session. Use the matching candidate in state for its context and rubric.",
      },
    },
  ]);
  t.check(runtime.sends, [
    {
      message: "<external-input source=\"apple-app-intents\">Renew the car registration</external-input>",
      user: "ari@example.com",
      channel: null,
    },
  ]);
  t.check((await api.home()).open, []);

  // If the server stops after delivery and before writing `sent`, the second
  // delivery of the same message id is answered as a duplicate, with no outcome.
  // The record becomes `sent` with the destination it stored before delivery, and
  // without `queued`, which cannot be recovered. Here the first delivery claims the
  // id and then fails before answering.

  const crashing = scriptedRuntime(box.root, { send: () => { throw new Error("server stopped"); } });
  const lost = { id: randomUUID(), message: "Pay the water bill" };
  const crash = await capturingLogs(() => api.submit(lost));
  t.check([face(crash.result), crash.lines], [
    {
      state: "sending",
      destination: {
        label: "“Plan the week”",
        sessionId: str`${any(String)}`,
      },
      lastError: "server stopped",
    },
    [
      str`error [quick-chat] delivery of ${uuid()} failed: Error: server stopped`,
    ],
  ]);

  t.check(face(await api.submit(lost)), {
    state: "sent",
    destination: {
      label: "“Plan the week”",
      sessionId: str`${any(String)}`,
    },
  });

  const waterBill = { message: "<typed source=\"box-screen\">Pay the water bill</typed>", user: "ari@example.com", channel: null };
  t.check(crashing.sends, [waterBill, waterBill]);

  // The message-id claim lasts seven days. Six days after the first delivery
  // attempt, a retry is refused without sending: the row says the message may
  // already be in the chat and offers only Open chat and Discard.

  clearChatRuntime(box.root);
  const late = { id: randomUUID(), message: "Book the dentist" };
  await api.submit(late);
  const lateRuntime = scriptedRuntime(box.root);
  const realTime = process.env["BBX_TIME"];
  process.env["BBX_TIME"] = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const refused = await api.submit(late);
  if (realTime === undefined) delete process.env["BBX_TIME"]; else process.env["BBX_TIME"] = realTime;
  t.check([face(refused)], [
    {
      state: "sending",
      destination: {
        label: "“Plan the week”",
        sessionId: str`${any(String)}`,
      },
      lastError: "This may already be in “Plan the week”. Open the chat to check.",
      expired: true,
    },
  ]);
  t.check(lateRuntime.sends, []);
});

// ## A destination that is gone asks again
//
// A chat deleted between routing and delivery answers the send route's named
// 410. The record goes back to `needs-choice` with `reason: "destination-gone"`,
// and the gone chat is not offered again. A new chat whose landmark was removed
// is gone the same way, before any reservation.
void test("A chat deleted between routing and delivery answers the send route's named 410.", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box } = await gardenBox();
  const runtime = scriptedRuntime(box.root, { resolve: () => ({ ok: false, status: 410, error: "Conversation is not available on this machine", code: "CHAT_SESSION_UNAVAILABLE" }) });
  const api = caller(box.root, judged({ c0: 0.95, c1: 0.03, c2: 0.02 }));
  t.check([face(await api.submit({ id: randomUUID(), message: "Order more mulch" }))], [
    {
      state: "needs-choice",
      reason: "destination-gone",
      choices: [
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
  ]);
  t.check(runtime.sends, []);

  scriptedRuntime(box.root);
  const gardenApi = caller(box.root, judged({ c0: 0.02, c1: 0.95, c2: 0.03 }));
  const pending = { id: randomUUID(), message: "Start a seed list" };
  clearChatRuntime(box.root);
  await gardenApi.submit(pending);
  await rm(box.path("_content/Garden/Garden.landmark.card"));
  const reservations = scriptedRuntime(box.root).reservations;
  t.check(face(await gardenApi.submit(pending)), {
    state: "needs-choice",
    reason: "destination-gone",
    choices: [
      { candidateId: "c2", label: "New general chat" },
      { candidateId: "c0", label: "“Plan the week”" },
    ],
  });
  t.check(reservations, []);
});

// ## A new chat on an engine without reservations has no session id yet
//
// Codex assigns the session id when its first turn runs, so the record cannot
// name it. (This box lists no Claude chats, so its candidates are a new chat in
// Garden, `c0`, and a new general chat, `c1`.) The view names the destination without a session; the box screen
// offers "All chats" instead of "Open chat".
void test("Codex assigns the session id when its first turn runs, so the record cannot n...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box } = await gardenBox();
  await box.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));
  const runtime = scriptedRuntime(box.root, { reserve: "unsupported" });
  const view = await caller(box.root, judged({ c0: 0.02, c1: 0.98 })).submit({ id: randomUUID(), message: "Start a reading list" });
  t.check([face(view), runtime.targets.map(({ sessionParam, exactSession, contextDir, engine }) => ({ sessionParam, exactSession, contextDir, engine }))], [
    {
      state: "sent",
      destination: {
        label: "New general chat",
      },
    },
    [
      {
        sessionParam: "new",
        exactSession: false,
        contextDir: "",
        engine: "codex",
      },
    ],
  ]);
});

// ## Discard ends a stored thought
//
// A thought that was not sent can be discarded. It leaves the unfinished list. A
// sent thought cannot be discarded and comes back unchanged.
void test("A thought that was not sent can be discarded.", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box } = await gardenBox();
  scriptedRuntime(box.root);
  const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
  const unsure = await api.submit({ id: randomUUID(), message: "Maybe repaint the fence" });
  t.check((await api.home()).open, [
    {
      id: unsure.id,
      message: "Maybe repaint the fence",
      createdAt: isoDate(),
      state: "needs-choice",
      reason: "uncertain",
      choices: [
        { candidateId: "c0", label: "“Plan the week”" },
        { candidateId: "c1", label: "New chat in Garden" },
        { candidateId: "c2", label: "New general chat" },
      ],
    },
  ]);
  t.check(face(await api.discard({ id: unsure.id })), { state: "discarded" });
  t.check((await api.home()).open, []);

  const sent = await api.choose({ id: (await api.submit({ id: randomUUID(), message: "Fix the gate" })).id, candidateId: "c0" });
  t.check((await api.discard({ id: sent.id })).state, "sent");

  t.check(await failure(() => api.discard({ id: randomUUID() })), "NOT_FOUND: This message is no longer stored.");
});

// ## Home: what the box screen shows
//
// `home` lists unfinished thoughts, the ones sent in the last day, recent chats,
// and the box's `nav.card` shortcuts. Recent chats are the chats whose directory
// has a landmark, plus the last chat wherever it is: this box's only chat is at
// the root, which has no landmark, so its row has a null landmark and the label
// the Chats list gives it (an untitled chat's quoted opening). Shortcuts are box-relative; the routes the box screen already shows are
// left out.
void test("home lists unfinished thoughts, the ones sent in the last day, recent chats,...", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, sessionId } = await gardenBox();
  scriptedRuntime(box.root);
  await box.write("nav.card", "---\nentries:\n  - { href: /questions }\n  - { href: /browse }\n  - { ref: /_content/Garden/Garden.landmark.card, label: Garden plan }\n---\n");
  const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
  await api.submit({ id: randomUUID(), message: "Unsure thought" });
  await api.choose({ id: (await api.submit({ id: randomUUID(), message: "Sorted thought" })).id, candidateId: "c0" });
  const home = await api.home();
  const rootChats = home.recentChats.map((chat) => [chat.sessionId, chat.label, chat.landmark]);
  t.check([home.open.map((view) => [view.message, view.state]), home.recentlySent.map((view) => [view.message, view.state]), rootChats, home.shortcuts], [
    [
      [
        "Unsure thought",
        "needs-choice",
      ],
    ],
    [
      [
        "Sorted thought",
        "sent",
      ],
    ],
    [
      [
        sessionId,
        "“Plan the week”",
        null,
      ],
    ],
    [
      {
        label: "Questions",
        to: "/questions",
      },
      {
        label: "Garden plan",
        to: "/views/_content/Garden/Garden.landmark.card",
      },
    ],
  ]);

  // Every procedure needs an authenticated caller.

  const anonymous = callerFor(box.root, { authed: false });
  t.check([await failure(() => anonymous.home()), await failure(() => anonymous.submit({ id: randomUUID(), message: "x" })), await failure(() => anonymous.discard({ id: randomUUID() }))], [
    "UNAUTHORIZED: Not authenticated",
    "UNAUTHORIZED: Not authenticated",
    "UNAUTHORIZED: Not authenticated",
  ]);
});

// ## The last chat leads the recent chats, once
//
// The recent chats are newest first. A last chat without a landmark leads the
// landmark chats. When the last chat has a landmark it is already in the list,
// and it appears once; a chat without a landmark that is not the last one is left
// out, as the other recent-chat lists leave it out.
void test("The recent chats are newest first.", async (t) => {
  t.teardown(async () => {
    try {
      clearChatRuntime(box.root);
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, sessionId: rootChat } = await gardenBox();
  scriptedRuntime(box.root);
  const gardenChat = randomUUID();
  const gardenLog = getSessionLogPath(containedSessionCwd(box.root, "_content/Garden"), gardenChat);
  await mkdir(dirname(gardenLog), { recursive: true });
  await writeFile(gardenLog, JSON.stringify({ type: "user", uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Order seeds" }] } }) + "\n");
  await box.write(`_content/chat/web/2026-09-22_${gardenChat}.chat.card`, `---\nsession: ${gardenChat}\ncontext-dir: _content/Garden\n---\n\n`);
  const api = caller(box.root, judged({ c0: 1 }));
  const rows = async () => (await api.home()).recentChats.map((chat) => [chat.sessionId, chat.landmark?.label ?? null]);

  const earlier = new Date(Date.now() - 60_000);
  await utimes(gardenLog, earlier, earlier);
  t.check(await rows(), [
    [
      rootChat,
      null,
    ],
    [
      gardenChat,
      "Garden",
    ],
  ]);

  const rootLog = getSessionLogPath(box.root, rootChat);
  const earliest = new Date(Date.now() - 120_000);
  await utimes(rootLog, earliest, earliest);
  t.check(await rows(), [
    [
      gardenChat,
      "Garden",
    ],
  ]);
});

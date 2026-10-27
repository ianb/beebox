// # A reload cannot see the message the box just accepted
//
// `POST /api/chat/send` answers 200 once the message is **durably recorded** — the
// route says so itself: it emits the persisted `chat-user-message` onto the box's
// event bus and takes the durable claim, and *"recording it IS acceptance"*
// (`webapp/routes/chat-send-routes.ts`). Only after that does the engine start.
//
// `chat.bootstrap` — what a page load runs — reads the session transcript and
// nothing else (`core/chat/session/load-history.ts`). The transcript is written by
// the agent subprocess, some time after the run begins.
//
// Between those two facts is a window where the box has told the client it has the
// message, has a durable record proving it, and would answer a reload by showing a
// conversation that does not contain it. Live clients do not notice: they hold an
// optimistic copy in memory and see the bus event over the WebSocket. A reload has
// neither — a fresh page has no memory, and bootstrap never consults the bus.
//
// This reproduces that window rather than fixing it, so the size and shape of the
// gap are pinned before anything moves
// (`issues/bugs/2026-08-09-reload-loses-in-flight-question.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TestServer } from "../../../helpers/test-route-server.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { createFakeChatBackend, type FakeChatBackendRun } from "../../../../src/services/claude-chat/core.js";
import type { BusEvent } from "../../../../src/core/event-bus/core.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function caller(server: TestServer) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: server.boxRoot,
    eventBus: server.eventBus,
    isAuthenticatedOwner: true,
  });
  return appRouter.createCaller(ctx);
}

// The `message` field of a chat-user-message payload.
function messageOf(data: unknown): unknown {
  return typeof data === "object" && data !== null && "message" in data ? data.message : undefined;
}

// What the chat page asks for on load.
const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 } as const;

async function readDedupState(boxRoot: string) {
  try {
    return await readFile(join(boxRoot, ".beebox", "message-dedup.json"), "utf-8");
  } catch (_e) {
    return "(no file)";
  }
}

// The pending row for the first send in the test; the server stamps it with the real clock.
const DRAWER_KEY_ROW = {
  uuid: "accepted-1",
  type: "user",
  timestamp: isoDate(),
  content: [{ type: "text", text: "<typed>where did I put the drawer key?</typed>" }],
  messageId: "m-1", // the send's id, which the client matches its optimistic copy by
  reconcileKnownUuids: [],
} as const;

// ## The send is accepted and recorded; the reload sees nothing
//
// The fake backend stands in for the agent subprocess. Like the real one it writes
// no transcript of its own — the real subprocess writes one eventually, which is
// precisely the lag being modelled here.
void test("The fake backend stands in for the agent subprocess.", async (t) => {
  t.teardown(async () => {
    try {
      // The send's run starts unawaited, behind a bootstrap git commit. Deleting
      // the box under that commit left its child process holding the file open
      // until the 300s timeout (2026-10-09), so cleanup waits for the backend.
      await runStarted;
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  const realStart = backend.start.bind(backend);
  const runStarted = new Promise<FakeChatBackendRun>((resolve) => {
    backend.start = (opts) => { const run = realStart(opts); const fake = backend.lastRun(); if (fake) resolve(fake); return run; };
  });
  const ctx = await makeTestServer({ chatBackend: backend });

  const recorded: string[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(messageOf(e.data))); },
  });

  const sent = await ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "<typed>where did I put the drawer key?</typed>", messageId: "m-1" },
  });
  t.check(sent.statusCode, 200);
  t.check(recorded, ["<typed>where did I put the drawer key?</typed>"]);

  // Now the reload. `chat.bootstrap` is the whole of what a fresh page knows:

  const boot = await caller(ctx).chat.bootstrap({ slice: TAIL });
  t.check({ kind: boot.kind, history: boot.history }, { kind: "empty", history: null });

  // `kind: "empty"` with an empty history is still the honest answer about what is
  // **durable**, and that is what `history` means. What was missing is the other
  // record — so bootstrap now also reports what the box has *accepted*:

  t.check(boot.pending, [DRAWER_KEY_ROW]);

  // `kind: "empty"` is the strongest form of the gap, and the one the field report
  // described. A message that opens a **new** chat is accepted before the engine has
  // assigned a session id, so there is not yet a session for the reload to resolve:
  // the page comes back to a blank chat — no history, no session, no sign the
  // message was ever sent — while `.beebox/message-dedup.json` on that same
  // box records the box having durably accepted it.

  const dedup = await readDedupState(ctx.boxRoot);
  await t.checkText(dedup, "{\"m-1\":«int»}");

  // The question is gone from the only thing a reloading client reads, while the box
  // holds a durable record of having accepted it. That is the bug, stated exactly:
  // not a lost message — a message that two readers disagree about.
  //
  // **Window.** For an existing session the transcript lands within ~150 ms of the
  // subprocess writing each entry (`transcript-sync.ts` measures that lag), so the
  // gap is small though real. For a new session it lasts until the engine starts and
  // the id is recorded — a cold spawn is allowed ten minutes
  // (`chat-send-run.ts` `RUN_START_TIMEOUT_MS`), which is why the report came from a
  // reload during a turn that "appeared stuck". The earlier guess that the SDK
  // batches transcript writes until a turn ends is **wrong**: the batcher that does
  // that (`TranscriptMirrorBatcher`) only runs when the SDK's `sessionStore` option
  // is set, which this codebase never sets, and it mirrors to an external store
  // *after* the local write succeeds.
  //
  // ## An acceptance is not shown to a chat it does not belong to
  //
  // A message accepted before the engine assigned an id carries no session, and the
  // first shape of this let such a row match *any* bootstrap — which would have put
  // a brand-new chat's unsent question inside whatever conversation happened to be
  // open. An id-less acceptance matches only an id-less bootstrap:

  const elsewhere = await caller(ctx).chat.bootstrap({ session: "some-other-session", slice: TAIL });
  t.check({ kind: elsewhere.kind, pending: elsewhere.pending }, { kind: "unavailable", pending: [] });

  // The send above carried no identity — an open box, nobody signed in — so there is
  // nobody to keep it from, and any reader of that box sees it:

  function callerAs(server: TestServer, email: string) {
    const scoped: TrpcContext = trpcContext({
      boxRoot: server.boxRoot,
      eventBus: server.eventBus,
      user: { email, name: email },
      isOwner: false,
    });
    return appRouter.createCaller(scoped);
  }
  const anyReader = await callerAs(ctx, "tomas@example.com").chat.bootstrap({ slice: TAIL });
  t.check(anyReader.pending, [DRAWER_KEY_ROW]);

  // A send that DOES name its sender is a different matter. An id-less row cannot be
  // told apart from another person's by session, so it is told apart by who sent it,
  // and it fails closed — a box where several people are each starting a chat does
  // not show them each other's unsent questions:

  ctx.eventBus.emit("chat-user-message", {
    sessionId: null,
    message: "<typed user=\"Rosa Okafor\">is the loft key on the hook?</typed>",
    user: { email: "rosa@example.com", name: "Rosa Okafor" },
    timestamp: new Date().toISOString(),
  });

  const asTomas = await callerAs(ctx, "tomas@example.com").chat.bootstrap({ slice: TAIL });
  const asRosa = await callerAs(ctx, "rosa@example.com").chat.bootstrap({ slice: TAIL });
  t.check({ tomas: asTomas.pending, rosa: asRosa.pending }, {
    tomas: [DRAWER_KEY_ROW],
    rosa: [
      DRAWER_KEY_ROW,
      {
        uuid: "accepted-2",
        type: "user",
        timestamp: isoDate(),
        content: [{ type: "text", text: "<typed user=\"Rosa Okafor\">is the loft key on the hook?</typed>" }],
        user: "Rosa Okafor",
        reconcileKnownUuids: [],
      },
    ],
  });
});

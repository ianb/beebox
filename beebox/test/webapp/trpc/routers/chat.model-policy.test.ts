// # Pinning the box's model
//
// `chat.setDefaultModel` pins the model every chat that made no choice of its own
// uses, and the model the reactor runs on. It is a statement about the box, not
// about a conversation: it restarts nothing, and `chat.status` keeps reporting
// what a live chat is actually running.
//
// Unlike `chat.setModel` — a per-chat control anyone using the box may reach —
// pinning writes box configuration and is owner-gated.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { TestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { ChatSessionStatus } from "../../../../src/webapp/trpc/routers/chat/control-procedures.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";

// The model-choice fields of chat.status; the rest of its payload is not this file's subject.
function modelView(status: Pick<ChatSessionStatus, "model" | "source" | "boxDefault">) {
  return { model: status.model, source: status.source, boxDefault: status.boxDefault };
}

function caller(server: TestServer, opts?: { isOwner?: boolean }) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: server.boxRoot,
    eventBus: server.eventBus,
    isOwner: opts?.isOwner !== false,
    actor: "none",
  });
  return appRouter.createCaller(ctx);
}

// A pin is visible to the next status read: an unopinionated chat reports the box
// default as the model it will use, and says where that came from. A box that has
// pinned nothing reports the `strong` tier for its engine rather than `null`.
void test("A pin is visible to the next status read:", async (t) => {
  const server = await makeTestServer();
  const initial = await caller(server).chat.status({});
  t.check(modelView(initial), {
    model: str`${any(String)}`,
    source: "default",
    boxDefault: str`${any(String)}`,
  });

  await caller(server).chat.setDefaultModel({ model: "claude-sonnet-5-5" });
  clearBoxConfigCache(server.boxRoot);
  t.check(modelView(await caller(server).chat.status({})), {
    model: "claude-sonnet-5-5",
    source: "default",
    boxDefault: "claude-sonnet-5-5",
  });

  // Clearing the pin returns the box to the `strong` tier, not to "whatever the
  // harness picks". An unpinned box still has a default it can name — that is what
  // lets the chat UI say what a follower will run, and what the model dial compares
  // against (boxholder, 2026-09-14: *"using the harness default is hard to
  // understand"*).

  await caller(server).chat.setDefaultModel({ model: null });
  clearBoxConfigCache(server.boxRoot);
  t.check((await caller(server).chat.status({})).boxDefault, initial.boxDefault);

  // A model the box's engine cannot run is refused at the boundary rather than
  // stored and silently ignored later.

  const foreign = "gpt-6.1-sol";
  await t.checkThrows(() => caller(server).chat.setDefaultModel({ model: foreign }), `TRPCError: Model ${foreign} is unavailable for claude chats`);

  // A model no engine offers is refused by the settings path too, rather than being
  // saved and then dropped on every read.

  await t.checkThrows(() => caller(server).admin.updateBoxConfig({ agentModel: "sonnet" }), "TRPCError: Unknown model id sonnet");

  // Pinning is the owner's call.

  t.check(await caller(server, { isOwner: false }).chat.setDefaultModel({ model: "claude-sonnet-5-5" }).catch((e) => e.code), "FORBIDDEN");

  // A pi box cannot clear its pin: pi has no model of its own.

  const qwen = { id: "qwen/qwen3-coder", label: "Qwen3 Coder" };
  await writeFile(join(server.boxRoot, "_config/box.json"), JSON.stringify({ agentEngine: "pi", agentModel: qwen.id, openrouterModels: [qwen] }));
  clearBoxConfigCache(server.boxRoot);
  t.check(await caller(server).chat.setDefaultModel({ model: null }).catch((e) => `${e.code}: ${e.message}`), "BAD_REQUEST: "
    + "The pi engine runs only models added in Admin → OpenRouter models. Choose one of them as the default model in the same save.");

  await server.cleanup();
});

// ## A per-chat control needs a chat
//
// `chat.setModel` and `chat.setFeature` change a setting on a conversation that
// exists. Both reach `registry.getOrCreate`, which builds a session object for any
// id at all, so an id the box had no record of was registered by the control
// itself — and a registered id then read as resumable, so the next send resumed a
// conversation that never existed, on whichever engine the box defaulted to. They
// answer `NOT_FOUND` instead.
void test("chat.setModel and chat.setFeature change a setting on a conversation that exi...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const server = await makeTestServer();
  const api = caller(server);
  const claudeDefault = (await api.chat.status({})).boxDefault;
  assert.ok(claudeDefault, "an unpinned box still names a default");
  const unknown = "11111111-2222-3333-4444-555555555555";

  t.check([
    await api.chat.setModel({ session: unknown, model: "claude-sonnet-5-5" }).catch((e) => e.code),
    await api.chat.setFeature({ session: unknown, feature: "narration", value: "on" }).catch((e) => e.code),
  ], ["NOT_FOUND", "NOT_FOUND"]);

  // The id is also not left behind in the registry — refusing it and registering it
  // anyway would leave the ghost the next reader has to disbelieve:

  t.check(getChatRuntime(server.boxRoot)?.registry.get(unknown), null);

  // A reservation IS a record, so a coined chat still takes settings before its
  // first message, and the engine that answers is the reservation's rather than the
  // box's. This is the case the refusal above must not break — on a codex-default
  // box, a Claude model on a coined Claude chat is still accepted:

  await api.admin.updateBoxConfig({ agentEngine: "codex", engines: { claude: true, codex: true } });
  clearBoxConfigCache(server.boxRoot);
  const receipt = await api.chat.reserveSession({
    sessionId: "22222222-3333-4444-8555-666666666666",
    engine: "claude",
    model: claudeDefault,
  });
  t.check(receipt.kind, "reserved");
  t.check(await api.chat.setModel({ session: "22222222-3333-4444-8555-666666666666", model: "claude-sonnet-5-5" }), { ok: true, model: "claude-sonnet-5-5", restarted: false });

  // A reservation that names a model but no engine records the engine the model
  // was checked against. Leaving it implicit let a Claude model validate and then
  // start on the box's Codex default, quietly running something else.

  const { resolveChatEngine } = await import("../../../../src/core/chat/session/engine.js");
  const implicit = "33333333-4444-4555-8666-777777777777";
  t.check((await api.chat.reserveSession({ sessionId: implicit, model: claudeDefault })).kind, "reserved");
  t.check(await resolveChatEngine(server.boxRoot, { sessionId: implicit }), "claude");
});

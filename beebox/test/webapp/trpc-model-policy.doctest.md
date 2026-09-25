# Pinning the box's model

`chat.setDefaultModel` pins the model every chat that made no choice of its own
uses, and the model the reactor runs on. It is a statement about the box, not
about a conversation: it restarts nothing, and `chat.status` keeps reporting
what a live chat is actually running.

Unlike `chat.setModel` — a per-chat control anyone using the box may reach —
pinning writes box configuration and is owner-gated.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { getChatRuntime } from "../../src/webapp/chat-runtime.js";

function caller(server, opts) {
  return appRouter.createCaller({
    boxRoot: server.boxRoot,
    boxSlug: "test",
    eventBus: server.eventBus,
    services: {},
    user: null,
    authed: true,
    isOwner: opts?.isOwner !== false,
  });
}
```

A pin is visible to the next status read: an unopinionated chat reports the box
default as the model it will use, and says where that came from. A box that has
pinned nothing reports the `strong` tier for its engine rather than `null`.

```ts
const server = await makeTestServer();
JSON.stringify(await caller(server).chat.status({}))
=> {"sessionId":null,"running":false,"busy":false,"model":"claude-opus-5-5","source":"default","boxDefault":"claude-opus-5-5","pendingModel":null,"engine":"claude","enabledEngines":["claude"],"boxEngine":"claude","glmAvailable":false,"addedModels":[]}

await caller(server).chat.setDefaultModel({ model: "claude-sonnet-5" });
clearBoxConfigCache(server.boxRoot);
JSON.stringify(await caller(server).chat.status({}))
=> {"sessionId":null,"running":false,"busy":false,"model":"claude-sonnet-5","source":"default","boxDefault":"claude-sonnet-5","pendingModel":null,"engine":"claude","enabledEngines":["claude"],"boxEngine":"claude","glmAvailable":false,"addedModels":[]}
```

Clearing the pin returns the box to the `strong` tier, not to "whatever the
harness picks". An unpinned box still has a default it can name — that is what
lets the chat UI say what a follower will run, and what the model dial compares
against (boxholder, 2026-09-14: *"using the harness default is hard to
understand"*).

```ts continue
await caller(server).chat.setDefaultModel({ model: null });
clearBoxConfigCache(server.boxRoot);
(await caller(server).chat.status({})).boxDefault
=> claude-opus-5-5
```

A model the box's engine cannot run is refused at the boundary rather than
stored and silently ignored later.

```ts continue
await caller(server).chat.setDefaultModel({ model: "gpt-6-sol" }).catch((e) => e.message)
=> Model gpt-6-sol is unavailable for claude chats
```

A model no engine offers is refused by the settings path too, rather than being
saved and then dropped on every read.

```ts continue
await caller(server).admin.updateBoxConfig({ agentModel: "sonnet" }).catch((e) => e.message.includes("Unknown model id"))
=> true
```

Pinning is the owner's call.

```ts continue
await caller(server, { isOwner: false }).chat.setDefaultModel({ model: "claude-sonnet-5" }).catch((e) => e.code)
=> FORBIDDEN

await server.cleanup();
```

## A per-chat control needs a chat

`chat.setModel` and `chat.setFeature` change a setting on a conversation that
exists. Both reach `registry.getOrCreate`, which builds a session object for any
id at all, so an id the box had no record of was registered by the control
itself — and a registered id then read as resumable, so the next send resumed a
conversation that never existed, on whichever engine the box defaulted to. They
answer `NOT_FOUND` instead.

```ts
const server = await makeTestServer();
const api = caller(server);
const unknown = "11111111-2222-3333-4444-555555555555";

JSON.stringify([
  await api.chat.setModel({ session: unknown, model: "claude-sonnet-5" }).catch((e) => e.code),
  await api.chat.setFeature({ session: unknown, feature: "narration", value: "on" }).catch((e) => e.code),
])
=> ["NOT_FOUND","NOT_FOUND"]
```

The id is also not left behind in the registry — refusing it and registering it
anyway would leave the ghost the next reader has to disbelieve:

```ts continue
getChatRuntime(server.boxRoot)?.registry.get(unknown) === null
=> true
```

A reservation IS a record, so a coined chat still takes settings before its
first message, and the engine that answers is the reservation's rather than the
box's. This is the case the refusal above must not break — on a codex-default
box, a Claude model on a coined Claude chat is still accepted:

```ts continue
await api.admin.updateBoxConfig({ agentEngine: "codex", engines: { claude: true, codex: true } });
clearBoxConfigCache(server.boxRoot);
const receipt = await api.chat.reserveSession({
  sessionId: "22222222-3333-4444-8555-666666666666",
  engine: "claude",
  model: "claude-haiku-4-5-20251001",
});
print(`reserved: ${receipt.kind}`);
const setOnCoined = await api.chat
  .setModel({ session: "22222222-3333-4444-8555-666666666666", model: "claude-sonnet-5" })
  .then((r) => `ok model=${String(r.model)}`, (e) => `${String(e.code)}: ${String(e.message)}`);
print(setOnCoined);
=>
reserved: reserved
ok model=claude-sonnet-5
```

A reservation that names a model but no engine records the engine the model
was checked against. Leaving it implicit let a Claude model validate and then
start on the box's Codex default, quietly running something else.

```ts continue
const { resolveChatEngine } = await import("../../src/core/chat/session/engine.js");
const implicit = "33333333-4444-4555-8666-777777777777";
print(`reserved: ${(await api.chat.reserveSession({ sessionId: implicit, model: "claude-haiku-4-5-20251001" })).kind}`);
print(`engine: ${await resolveChatEngine(server.boxRoot, { sessionId: implicit })}`);
=>
reserved: reserved
engine: claude
```

```ts cleanup
await server.cleanup();
```

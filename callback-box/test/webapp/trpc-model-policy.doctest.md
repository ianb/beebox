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
default as the model it will use, and says where that came from.

```ts
const server = await makeTestServer();
JSON.stringify(await caller(server).chat.status({}))
=> {"sessionId":null,"running":false,"busy":false,"model":null,"source":"none","boxDefault":null,"pendingModel":null,"engine":"claude"}

await caller(server).chat.setDefaultModel({ model: "claude-sonnet-5" });
clearBoxConfigCache(server.boxRoot);
JSON.stringify(await caller(server).chat.status({}))
=> {"sessionId":null,"running":false,"busy":false,"model":"claude-sonnet-5","source":"default","boxDefault":"claude-sonnet-5","pendingModel":null,"engine":"claude"}
```

Clearing the pin returns the box to its harness default.

```ts continue
await caller(server).chat.setDefaultModel({ model: null });
clearBoxConfigCache(server.boxRoot);
(await caller(server).chat.status({})).boxDefault
=> null
```

A model the box's engine cannot run is refused at the boundary rather than
stored and silently ignored later.

```ts continue
await caller(server).chat.setDefaultModel({ model: "gpt-5.6-sol" }).catch((e) => e.message)
=> Model gpt-5.6-sol is unavailable for claude chats
```

Pinning is the owner's call.

```ts continue
await caller(server, { isOwner: false }).chat.setDefaultModel({ model: "claude-sonnet-5" }).catch((e) => e.code)
=> FORBIDDEN

await server.cleanup();
```

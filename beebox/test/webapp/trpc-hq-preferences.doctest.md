# HQ preference inheritance across a reserved chat

A Claude chat gets a client-coined id before its first message. Reserving that
id captures the box and landmark defaults, but does not write chat history yet.
The feature read used by a page reload must therefore consult the reservation:
disk alone has no row and would reset the UI to the registry default (`off`).

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { appendHistory, getFeaturesForSession, updateFeaturesForSession } from "../../src/core/chat/session/history.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { getChatRuntime } from "../../src/webapp/chat-runtime.js";

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

function caller(server) {
  return appRouter.createCaller({
    boxRoot: server.boxRoot,
    boxSlug: "test",
    eventBus: server.eventBus,
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  });
}
```

## Box on plus landmark inherit

The root landmark declares no HQ value, so a new chat inherits the box's `on`.
The page immediately receives a reserved id; reading that id must still report
the inherited value.

```ts
const backend = createFakeChatBackend();
const server = await makeTestServer({ chatBackend: backend });
const api = caller(server);
await server.seed(
  "_content/Box.landmark.card",
  "---\nnavigation:\n  label: Box\n---\n",
);
await api.admin.updateBoxConfig({ hqDictation: "on" });
clearBoxConfigCache(server.boxRoot);

const inherited = "11111111-1111-4111-8111-111111111111";
await api.chat.reserveSession({ sessionId: inherited, contextDir: "", engine: "claude" });
JSON.stringify(await api.chat.features({ session: inherited }))
=> {"features":{"narration":"off","prose":"on","hq-dictation":"on"}}
```

An explicit per-chat `off` overrides the inherited `on` and survives the same
reload read even though the chat has not started and still has no history row.

```ts continue
await api.chat.setFeature({ session: inherited, feature: "hq-dictation", value: "off" });
print(`reload: ${JSON.stringify(await api.chat.features({ session: inherited }))}`);
print(`history: ${JSON.stringify(await getFeaturesForSession(server.boxRoot, inherited))}`);
=>
reload: {"features":{"narration":"off","prose":"on","hq-dictation":"off"}}
history: null
```

## Landmark on plus box off

Landmark precedence uses the same reservation path. Changing the defaults does
not rewrite the earlier chat's explicit choice; a newly reserved chat gets the
new effective value.

```ts continue
await api.admin.updateBoxConfig({ hqDictation: "off" });
clearBoxConfigCache(server.boxRoot);
await server.seed(
  "_content/Box.landmark.card",
  "---\nnavigation:\n  label: Box\n  chat-app:\n    hq-dictation: on\n---\n",
);

const landmarkOn = "22222222-2222-4222-8222-222222222222";
await api.chat.reserveSession({ sessionId: landmarkOn, contextDir: "", engine: "claude" });
print(`earlier chat: ${(await api.chat.features({ session: inherited })).features["hq-dictation"]}`);
print(`new landmark chat: ${(await api.chat.features({ session: landmarkOn })).features["hq-dictation"]}`);
=>
earlier chat: off
new landmark chat: on
```

Once that reserved chat starts, later toggles leave the reservation path and
persist to history. The now-released reservation must not keep swallowing
updates into its orphaned in-memory record.

```ts continue
const accepted = await server.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: landmarkOn, message: "hello", messageId: "hq-start" },
});
await waitFor(async () =>
  getChatRuntime(server.boxRoot)?.registry.getReservation(landmarkOn) === null
    && (await getFeaturesForSession(server.boxRoot, landmarkOn))?.["hq-dictation"] === "on"
);
await api.chat.setFeature({ session: landmarkOn, feature: "hq-dictation", value: "off" });
print(`accepted: ${accepted.statusCode}`);
print(`reload: ${(await api.chat.features({ session: landmarkOn })).features["hq-dictation"]}`);
print(`history: ${(await getFeaturesForSession(server.boxRoot, landmarkOn))?.["hq-dictation"]}`);
=>
accepted: 200
reload: off
history: off
```

## Persisted state outranks an unloaded live session

An existing chat can acquire a live registry entry through another control
before its feature store has loaded. That empty in-memory store must not mask
the persisted value on reload.

```ts continue
const started = "33333333-3333-4333-8333-333333333333";
await appendHistory(server.boxRoot, { sessionId: started, engine: "claude" });
await updateFeaturesForSession(server.boxRoot, {
  sessionId: started,
  updates: { "hq-dictation": "on" },
  engine: "claude",
});
await api.chat.setModel({ session: started, model: "claude-sonnet-5" });
(await api.chat.features({ session: started })).features["hq-dictation"]
=> on
```

```ts cleanup
await server.cleanup();
```

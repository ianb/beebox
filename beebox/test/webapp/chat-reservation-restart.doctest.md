# Restoring a coined Claude chat after a server restart

A coined Claude chat has no transcript or history row before its first message.
On a Codex-default box, losing the in-memory reservation makes history choose
the box default and ask Codex for a UUID that belongs to no Codex thread. The
client's exact receipt must restore the reservation before either bootstrap or
history runs.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { getChatRuntime, setChatRuntime } from "../../src/webapp/chat-runtime.js";
import { ChatSessionRegistry } from "../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { plainTestPrompt } from "../helpers/chat-session-spawner-helpers.js";

const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 } as const;
const ID = "11111111-1111-4111-8111-111111111111";
let restartedRegistry: ChatSessionRegistry | null = null;
function caller(server) {
  return appRouter.createCaller({ boxRoot: server.boxRoot, boxSlug: "test",
    eventBus: server.eventBus, services: {}, user: null, authed: true, isOwner: true });
}
```

The first reservation carries Claude, its model, and its landmark. Replacing
the registry simulates the process-local state lost by a development reload.
Before recovery, bootstrap reports the chat unavailable, while raw history
follows the Codex box default and throws an internal error. Re-reserving the receipt's exact values makes both bootstrap and history
safe again without creating a different conversation.

```ts
const server = await makeTestServer({ chatBackend: createFakeChatBackend() });
const api = caller(server);
await api.admin.updateBoxConfig({ agentEngine: "codex",
  engines: { claude: true, codex: true } });
const receipt = { sessionId: ID, contextDir: "_content/papers",
  engine: "claude" as const, model: "claude-haiku-4-5-20251001" };
await api.chat.reserveSession(receipt);

const original = getChatRuntime(server.boxRoot)!;
// A real process restart clears reserve.ts's module-level engine index too.
// The test process keeps the module loaded, so release that one record at the
// boundary before replacing the registry.
(original.registry as unknown as { reservations: { release(id: string): void } })
  .reservations.release(ID);
await original.registry.shutdown();
restartedRegistry = new ChatSessionRegistry(server.boxRoot, {
  backend: createFakeChatBackend(),
  buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
});
setChatRuntime(server.boxRoot, { ...original, registry: restartedRegistry });

const missing = await api.chat.bootstrap({ session: ID, slice: TAIL });
missing.kind
=> unavailable

await api.chat.history({ session: ID, slice: TAIL }).then(
  () => "unexpected history success",
  (error: Error) => error.message,
)
=> Codex history request failed

const reserved = await api.chat.reserveSession(receipt);
const bootstrap = await api.chat.bootstrap({ session: ID, slice: TAIL });
const history = await api.chat.history({ session: ID, slice: TAIL });
const restored = restartedRegistry.getReservation(ID)!;
JSON.stringify({ reserved: reserved.kind, bootstrap: bootstrap.kind,
  bootstrapId: bootstrap.sessionId, historyId: history.sessionId,
  contextDir: restored.contextDir, engine: restored.engine, model: restored.model })
=> {"reserved":"reserved","bootstrap":"resumable","bootstrapId":"11111111-1111-4111-8111-111111111111","historyId":"11111111-1111-4111-8111-111111111111","contextDir":"_content/papers","engine":"claude","model":"claude-haiku-4-5-20251001"}
```

```ts cleanup
await restartedRegistry?.shutdown();
await server.cleanup();
```

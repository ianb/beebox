# Restoring a coined Claude chat after a server restart

A coined Claude chat has no transcript or history row before its first message —
its reservation is the only record of it, and that record is in memory. A
development reload drops it, and on a Codex-default box the id is then one the
box has no record of at all. The client's exact receipt is what restores it, and
until it does, every read of the chat must degrade to "nothing here" rather than
to an engine's failure.

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
Before recovery both reads report emptiness rather than failure: bootstrap says
unavailable, and history — which used to take the Codex box default and throw
`Codex history request failed` for a UUID belonging to no Codex thread
(`issues/bugs/2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md`) —
answers an empty transcript, because an id with no record is not routed to an
engine at all. Re-reserving the receipt's exact values makes both reads resolve
the real chat again without creating a different conversation.

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
  (result) => `empty: ${String(result.entries.length === 0 && result.total === 0)}`,
  (error: Error) => `threw: ${error.message}`,
)
=> empty: true

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

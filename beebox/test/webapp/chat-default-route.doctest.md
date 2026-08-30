# Raw chat default route

The iOS companion still needs a raw HTTP endpoint for resolving the current
chat session before native-only audio transcription calls. It mirrors
`trpc.chat.defaultSession`.

```ts setup
import Fastify from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerChatRoutes } from "../../src/webapp/routes/chat.js";

const boxRoot = await mkdtemp(join(tmpdir(), "bbx-chat-default-"));
const server = Fastify();
const eventBus = {
  emit: () => 0,
  emitTransient: () => {},
  readSince: () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
  prune: () => 0,
  close: () => {},
};
await registerChatRoutes({ server, boxRoot, eventBus });

async function getDefaultSession() {
  const res = await server.inject({ method: "GET", url: "/api/chat/default" });
  return `${res.statusCode}\n${JSON.stringify(res.json(), null, 2)}`;
}
```

## Missing pointer returns null

```ts
await getDefaultSession()
=>
200
{
  "sessionId": null
}
```

## Existing pointer returns the session id

```ts continue
await mkdir(join(boxRoot, ".beebox"), { recursive: true });
await writeFile(
  join(boxRoot, ".beebox/chat-session-id.json"),
  JSON.stringify({ sessionId: "ios-session-123", savedAt: "2026-07-10T12:00:00.000Z" }),
);
const existing = await getDefaultSession();
await server.close();
const history = JSON.parse(await readFile(join(boxRoot, ".beebox/chat-session-history.json"), "utf8"));
`${existing}\nmaintenance migrated: ${history.migrated}`
=>
200
{
  "sessionId": "ios-session-123"
}
maintenance migrated: true
```

```ts cleanup
await rm(boxRoot, { recursive: true, force: true });
```

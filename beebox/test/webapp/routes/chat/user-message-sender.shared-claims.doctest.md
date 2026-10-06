# One sender, one set of message-id claims

`POST /api/chat/send` and `quickChat` deliver a person's message through the
same sender, which `routes/chat/register.ts` creates once per box and exposes
on the chat runtime as `sendUserMessage`. The send-route doctests cover the
route; they cannot show that the two paths share state. Here one message id
goes through both paths against one runtime, in each order, and the box
records one chat message.

```ts setup
import type { BusEvent } from "../../../../src/core/event-bus/core.js";
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";

/** Send through the runtime's sender into a new chat, as quickChat does. */
async function sendDirect(boxRoot: string, { message, messageId }: { message: string; messageId: string }) {
  const runtime = getChatRuntime(boxRoot);
  if (runtime === undefined) throw new Error("chat runtime is not registered");
  const resolved = await runtime.resolveSendTarget({ sessionParam: "new", contextDir: undefined, requestSeedFeatures: undefined, exactSession: false });
  if (!resolved.ok) throw new Error(resolved.error);
  const outcome = await runtime.sendUserMessage({ target: resolved.target, message, messageId, user: null, channel: "ios-native" });
  return outcome.body;
}

function shape(body: Record<string, unknown>): string {
  return "turnId" in body ? "turnId" : JSON.stringify(body);
}
```

The route sends first. The sender's later attempt with the same id is a
duplicate, answered from the durable claim.

```ts
const ctx = await makeTestServer({ chatBackend: createFakeChatBackend() });
const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const viaRoute = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { session: "new", message: "feed the cat", messageId: "route-first" } });
const viaSender = await sendDirect(ctx.boxRoot, { message: "feed the cat", messageId: "route-first" });
[viaRoute.statusCode, shape(viaRoute.body), shape(viaSender), recorded]
=> [200, "turnId", "{\"deduplicated\":true}", ["feed the cat"]]
```

The sender sends first. The route's later attempt with the same id is the
duplicate.

```ts continue
const senderFirst = await sendDirect(ctx.boxRoot, { message: "water the plants", messageId: "sender-first" });
const routeSecond = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { session: "new", message: "water the plants", messageId: "sender-first" } });
[shape(senderFirst), routeSecond.statusCode, shape(routeSecond.body), recorded]
=> ["turnId", 200, "{\"deduplicated\":true}", ["feed the cat", "water the plants"]]
```

```ts cleanup
await ctx.cleanup();
```

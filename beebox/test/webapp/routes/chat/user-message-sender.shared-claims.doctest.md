# One sender, one set of message-id claims

`POST /api/chat/send` and `quickChat` deliver a person's message through the
same sender, which `routes/chat/register.ts` creates once per box and exposes
on the chat runtime as `sendUserMessage`. The send-route doctests cover the
route; they cannot show that the two paths share state. Here one message id
goes through two paths against one runtime, in each order, and the box records
one chat message: first the route and the runtime's sender, then the route and
`quickChat.submit`, which uses the record id as the message id.

```ts setup
import type { BusEvent } from "../../../../src/core/event-bus/core.js";
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { quickChatRouter } from "../../../../src/webapp/trpc/routers/quick-chat.js";

/** A Jev stand-in that always places the thought in a new general chat, decisively. */
const generalJev = {
  async decide({ criteria }) {
    const ids = Object.keys(criteria);
    return { model: "synthetic-jev", confidence: 1,
      probabilities: Object.fromEntries(ids.map((id) => [id, criteria[id].startsWith("New general chat") ? 1 : 0])) };
  },
  async judge() { throw new Error("not used"); },
};

function quickChat(boxRoot: string, eventBus) {
  return quickChatRouter.createCaller({ boxRoot, boxSlug: "test", authed: true, user: null, services: { jev: generalJev }, eventBus });
}

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

`quickChat.submit` and the route share the claims too. The route sends first;
the submit's delivery of the same id is answered as a duplicate, and the record
is `sent` with the destination it stored before delivery.

```ts continue
const routeThenSubmit = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
await ctx.request({ method: "POST", url: "/api/chat/send", payload: { session: "new", message: "<typed>call the vet</typed>", messageId: routeThenSubmit } });
const submitted = await quickChat(ctx.boxRoot, ctx.eventBus).submit({ id: routeThenSubmit, message: "call the vet" });
[submitted.state, submitted.destination.label, "queued" in submitted, recorded.slice(2)]
=> ["sent", "New general chat", false, ["<typed>call the vet</typed>"]]
```

The submit sends first; the route's later send of the same id is the
duplicate.

```ts continue
const submitThenRoute = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const first = await quickChat(ctx.boxRoot, ctx.eventBus).submit({ id: submitThenRoute, message: "buy stamps" });
const routeAfter = await ctx.request({ method: "POST", url: "/api/chat/send", payload: { session: "new", message: "<typed>buy stamps</typed>", messageId: submitThenRoute } });
[first.state, routeAfter.statusCode, shape(routeAfter.body), recorded.slice(3)]
=> ["sent", 200, "{\"deduplicated\":true}", ["<typed>buy stamps</typed>"]]
```

```ts cleanup
await ctx.cleanup();
```

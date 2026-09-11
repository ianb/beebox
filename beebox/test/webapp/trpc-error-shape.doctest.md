# tRPC error responses sanitize internal failures

Server-side `onError` logging owns diagnosis. The client error shape never
contains server frames or raw internal error messages, even when `NODE_ENV` is
unset. Expected client errors keep their useful messages.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { publicProcedure, router } from "../../src/webapp/trpc/trpc.js";
import { TRPCError } from "@trpc/server";
import { MovedCardRecoveryCauseError } from "../../src/core/moved-card-recovery.js";
import { rename } from "node:fs/promises";
import { join } from "node:path";

function containsStack(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, "stack")) return true;
  return Object.values(value).some(containsStack);
}

const testRouter = router({
  explode: publicProcedure.query(() => {
    throw new Error("ENOENT: no such file, open '/private/server/secret.card'");
  }),
  moved: publicProcedure.query(() => {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Card not found: _content/Old.memo.card",
      cause: new MovedCardRecoveryCauseError("_content/archive/New.memo.card"),
    });
  }),
});
```

```ts
const previousNodeEnv = process.env.NODE_ENV;
delete process.env.NODE_ENV;
const originalError = console.error;
console.error = () => {};
const ctx = await makeTestServer();
const result = await (async () => {
  try {
    const response = await ctx.request({ method: "GET", url: "/api/trpc/definitelyMissing" });
    return { status: response.statusCode, hasStack: containsStack(response.body) };
  } finally {
    console.error = originalError;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
})();
JSON.stringify(result)
=> {"status":404,"hasStack":false}
```

```ts cleanup
await ctx.cleanup();
```

## An internal exception exposes neither its message nor stack

This exercises the formatter through tRPC's real Fastify adapter, with an
error message shaped like the original absolute-path leak.

```ts
const app = Fastify();
await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: testRouter },
});
const originalAdapterError = console.error;
console.error = () => {};
const internal = await (async () => {
  try {
    return await app.inject({ method: "GET", url: "/trpc/explode" });
  } finally {
    console.error = originalAdapterError;
  }
})();
const internalBody = internal.json();
JSON.stringify({
  status: internal.statusCode,
  message: internalBody.error.message,
  hasStack: containsStack(internalBody),
  leakedPath: internal.payload.includes("/private/server"),
})
=> {"status":500,"message":"Internal server error","hasStack":false,"leakedPath":false}
```

```ts cleanup
await app.close();
```

## A moved card exposes only its validated box-relative destination

```ts
const movedApp = Fastify();
await movedApp.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: testRouter },
});
const moved = await movedApp.inject({ method: "GET", url: "/trpc/moved" });
const movedBody = moved.json();
JSON.stringify({
  status: moved.statusCode,
  message: movedBody.error.message,
  recovery: movedBody.error.data.recovery,
})
=> {"status":404,"message":"Card not found: _content/Old.memo.card","recovery":{"kind":"moved","path":"_content/archive/New.memo.card"}}
```

```ts cleanup
await movedApp.close();
```

## `card.get` adds recovery only after its normal read misses

This uses the real card route and an unstaged Markdown rename. Recovery applies
to safe box files, not only typed `.card` files. The requested old path remains
a 404, with the validated destination carried separately.

```ts
const cardServer = await makeTestServer();
await cardServer.seed("_content/documents/legal/status.md", "Enough unchanged body text for Git to identify the Markdown rename.\n");
cardServer.commitAll("seed moved card");
await rename(
  join(cardServer.boxRoot, "_content/documents/legal/status.md"),
  join(cardServer.boxRoot, "_content/documents/legal/archive-status.md"),
);
const ordinaryInput = encodeURIComponent(JSON.stringify({ path: "_content/documents/legal/status.md" }));
const recoveringInput = encodeURIComponent(JSON.stringify({ path: "_content/documents/legal/status.md", recoverMoved: true }));
const originalCardError = console.error;
console.error = () => {};
const responses = await (async () => {
  try {
    return await Promise.all([
      cardServer.request({ method: "GET", url: `/api/trpc/card.get?input=${ordinaryInput}` }),
      cardServer.request({ method: "GET", url: `/api/trpc/card.get?input=${recoveringInput}` }),
    ]);
  } finally {
    console.error = originalCardError;
  }
})();
const [ordinaryResponse, cardResponse] = responses;
const ordinaryBody = ordinaryResponse.body as { error: { data: { recovery: unknown } } };
const cardBody = cardResponse.body as { error: { data: { recovery: unknown } } };
JSON.stringify({
  ordinary: ordinaryBody.error.data.recovery,
  optedIn: { status: cardResponse.statusCode, recovery: cardBody.error.data.recovery },
})
=> {"ordinary":null,"optedIn":{"status":404,"recovery":{"kind":"moved","path":"_content/documents/legal/archive-status.md"}}}
```

```ts cleanup
await cardServer.cleanup();
```

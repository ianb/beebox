# HTTP admission closes before waiting for accepted preparation

```ts setup
import Fastify from "fastify";
import { router, publicProcedure } from "../../src/webapp/trpc/trpc.js";
import { registerBoxAdmission, boxRequestsAreIdle } from "../../src/webapp/box-admission.js";
import { acquireBoxWork, closeBoxMaintenance, boxWorkEnvironment } from "../../src/lib/box-maintenance.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { connect } from "node:net";
```

```ts
const box = await makeTmpBox({ git: true });
const server = Fastify();
registerBoxAdmission(server, [{ slug: "test", boxRoot: box.root }]);
const entered = Promise.withResolvers();
const finish = Promise.withResolvers();
let permission;
server.post("/test/write", async () => {
  permission = boxWorkEnvironment().BBX_BOX_WORK;
  entered.resolve();
  await finish.promise;
  // Accepted work may still call its tools after closure.
  const nested = await acquireBoxWork(box.root, { reason: "test" });
  await nested.release();
  return { ok: true };
});
server.get("/test/read", async () => ({ ok: true }));
server.post("/auth/login", async () => ({ identity: true }));
server.get("/auth/google-services/callback", async () => ({ exchanged: true }));
const pending = server.inject({ method: "POST", url: "/test/write" });
await entered.promise;
const maintenance = await closeBoxMaintenance(box.root, { reason: "fixture", drainMs: 1000 });
JSON.stringify({ idle: boxRequestsAreIdle(box.root), permission: typeof permission, rejected: (await server.inject({ method: "POST", url: "/test/write" })).statusCode, read: (await server.inject("/test/read")).statusCode, oauth: (await server.inject("/auth/google-services/callback?state=test:nonce")).statusCode })
=> {"idle":false,"permission":"string","rejected":503,"read":200,"oauth":503}

// The refusal says what holds the box and how long, so a client can wait it out.
const refused = await server.inject({ method: "POST", url: "/test/write" });
JSON.stringify({ retryAfter: refused.headers["retry-after"], error: refused.json().error })
=> {"retryAfter":"1","error":"Box is closed for fixture; expected to reopen within 1 min"}

// Global identity remains available to inspect a closed box.
(await server.inject({ method: "POST", url: "/auth/login" })).statusCode
=> 200

const caller = router({ write: publicProcedure.mutation(() => "ok") }).createCaller({ boxRoot: box.root, boxSlug: "test", services: {}, eventBus: {}, user: null, authed: true, isOwner: true, isAuthenticatedOwner: true });
// A WebSocket mutation has no still-open HTTP request lease.
await caller.write().catch((error) => error.code)
=> SERVICE_UNAVAILABLE

finish.resolve();
(await pending).statusCode
=> 200

await maintenance.drain();
boxRequestsAreIdle(box.root)
=> true

await maintenance.complete();
```

```ts cleanup
finish.resolve();
await maintenance.release();
await server.close();
await box.cleanup();
```

## A request the client abandons releases its lease

An admitted request that never reaches a reply — the client dropped the
connection mid-body, as a phone on a poor link does with an upload — must not
hold the box open forever. Without a reply neither `onResponse` nor the
response's `finish` fires, so the abort itself has to release.

```ts
const abortBox = await makeTmpBox({ git: true });
const abortServer = Fastify();
registerBoxAdmission(abortServer, [{ slug: "test", boxRoot: abortBox.root }]);
abortServer.post("/test/upload", async () => ({ ok: true }));
const address = await abortServer.listen({ port: 0, host: "127.0.0.1" });
const socket = connect(Number(new URL(address).port), "127.0.0.1");
await new Promise((resolve) => socket.once("connect", resolve));
socket.write("POST /test/upload HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"partial\":");
const until = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20)); return check(); };
await until(() => !boxRequestsAreIdle(abortBox.root))
=> true

socket.destroy();
await until(() => boxRequestsAreIdle(abortBox.root))
=> true
```

```ts cleanup
socket.destroy();
await abortServer.close();
await abortBox.cleanup();
```

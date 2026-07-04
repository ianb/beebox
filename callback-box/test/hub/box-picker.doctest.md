# Hub box picker: lists only the boxes the session email can access (Track D, chunk D3)

`GET /` on the hub renders a minimal HTML page listing boxes — filtered
through the SAME fail-closed `allowedEmails` predicate a box uses for its
own ACL (`canAccessBox`, `src/webapp/box-access.ts`), not a copy of it.
When hub auth is off, every configured box is listed unconditionally (same
"open" semantics a standalone box gets without `GOOGLE_OAUTH_CLIENT_ID`).

```ts setup
import { registerBoxPicker } from "../../src/hub/box-picker.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";

process.env.CB_SESSION_SECRET = "test-session-secret-for-box-picker-doctest";

const boxA = await makeTmpBox();
await boxA.write("config/box.json", JSON.stringify({ allowedEmails: ["alice@example.com"] }));
const boxB = await makeTmpBox();
await boxB.write("config/box.json", JSON.stringify({ allowedEmails: ["bob@example.com"] }));

const boxes = [
  { slug: "box-a", boxRoot: boxA.root },
  { slug: "box-b", boxRoot: boxB.root },
];

async function startPicker() {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  registerBoxPicker(app, { boxes });
  await app.ready();
  return app;
}
```

## Hub auth off: every configured box is listed, no session needed

```ts
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
const openApp = await startPicker();
const openRes = await openApp.inject({ method: "GET", url: "/" });
openRes.statusCode
=> 200

openRes.body.includes(`href="/box-a/"`) && openRes.body.includes(`href="/box-b/"`)
=> true
```

```ts cleanup
await openApp.close();
```

## Hub auth on, no session: redirected to login

```ts
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-box-picker-doctest";
const gatedApp = await startPicker();
const noSessionRes = await gatedApp.inject({ method: "GET", url: "/" });
noSessionRes.statusCode
=> 302

noSessionRes.headers.location
=> /auth/login?returnTo=%2F
```

## Hub auth on, session for alice@example.com: only box-a is listed

```ts continue
const aliceCookie = signSession({ email: "alice@example.com", name: "Alice" });
const aliceRes = await gatedApp.inject({ method: "GET", url: "/", headers: { cookie: `${COOKIE_NAME}=${aliceCookie}` } });
aliceRes.statusCode
=> 200

aliceRes.body.includes(`href="/box-a/"`)
=> true

aliceRes.body.includes(`href="/box-b/"`)
=> false
```

## A session for an email on neither box's allowedEmails sees an empty list

```ts continue
const strangerCookie = signSession({ email: "stranger@example.com", name: "Stranger" });
const strangerRes = await gatedApp.inject({ method: "GET", url: "/", headers: { cookie: `${COOKIE_NAME}=${strangerCookie}` } });
strangerRes.statusCode
=> 200

strangerRes.body.includes(`href="/box-a/"`) || strangerRes.body.includes(`href="/box-b/"`)
=> false

strangerRes.body.includes("No boxes available")
=> true
```

```ts cleanup
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.CB_SESSION_SECRET;
await gatedApp.close();
await boxA.cleanup();
await boxB.cleanup();
```

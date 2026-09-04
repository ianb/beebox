# Hub box picker: serves the SPA at `/`, with a minimal ACL-filtered fallback (Track D, chunk D3)

`GET /` on the hub serves the SPA (its `/` route renders the styled
box-selection page and fetches the accessible-box list from `/api/boxes`). When
the frontend bundle isn't built it falls back to a minimal server-rendered list,
filtered through the SAME fail-closed `allowedEmails` predicate a box uses for
its own ACL (`canAccessBox`, `src/webapp/box-access.ts`), not a copy of it. When
hub auth is off, every configured box is listed unconditionally (same "open"
semantics a standalone box gets with the `openAccess` construction option).
Either way the route is auth-gated: an unauthenticated navigation redirects to
login.

```ts setup
import { registerBoxPicker } from "../../src/hub/box-picker.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-box-picker-doctest";

const boxA = await makeTmpBox();
await boxA.write("_config/box.json", JSON.stringify({ allowedEmails: ["alice@example.com"] }));
const boxB = await makeTmpBox();
await boxB.write("_config/box.json", JSON.stringify({ allowedEmails: ["bob@example.com"] }));

const boxes = [
  { slug: "box-a", boxRoot: boxA.root },
  { slug: "box-b", boxRoot: boxB.root },
];

// A path with no index.html forces the minimal-list fallback, which is where the
// ACL filtering lives; the SPA-served case gets a real index.html below.
const NO_FRONTEND = path.join(os.tmpdir(), "box-picker-no-frontend-doctest");

async function startPicker(frontendDist = NO_FRONTEND, openAccess = false) {
  const app = Fastify({ logger: false });
  // The box picker reads `request.server.openAccess` (the in-process seam that
  // replaced the BBX_ALLOW_UNAUTHENTICATED env opt-out); decorate it here as the
  // real hub does in createHubServer.
  app.decorate("openAccess", openAccess);
  await app.register(fastifyCookie);
  registerBoxPicker(app, { boxes, frontendDist });
  await app.ready();
  return app;
}
```

## Frontend built: `/` serves the SPA (box list comes from /api/boxes, not the HTML)

```ts
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
// "Hub auth off" is now the explicit openAccess construction option.
const distDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picker-dist-"));
await fs.promises.writeFile(path.join(distDir, "index.html"), `<!doctype html><html><body><div id="root"></div></body></html>`);
const spaApp = await startPicker(distDir, true);
const spaRes = await spaApp.inject({ method: "GET", url: "/" });
spaRes.statusCode
=> 200

spaRes.body.includes(`id="root"`)
=> true
```

```ts cleanup
await spaApp.close();
await fs.promises.rm(distDir, { recursive: true, force: true });
```

## Hub auth off, no frontend build: every configured box is listed, no session needed

```ts
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const openApp = await startPicker(NO_FRONTEND, true);
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
// Auth is required by default now (startPicker's openAccess defaults to false).
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-box-picker-doctest";
// Paired secret: an ID-without-secret half-config is now a loud
// MissingOAuthClientSecretError wherever auth routes register.
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-box-picker-doctest";
const gatedApp = await startPicker();
const noSessionRes = await gatedApp.inject({ method: "GET", url: "/" });
noSessionRes.statusCode
=> 302

noSessionRes.headers.location
=> /auth/login?returnTo=%2F
```

## Hub auth on, session for alice@example.com: only box-a is listed (fallback)

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
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.BBX_SESSION_SECRET;
await gatedApp.close();
await boxA.cleanup();
await boxB.cleanup();
```

# Mobile auth for SPA fallback

In hub mode, a box normally requires hub-injected identity headers before it
serves the SPA fallback. A mobile companion has its own per-box token instead:
the initial embedded document request must be allowed through so the frontend
can boot and seed subsequent API/WebSocket calls with the same token.

```ts setup
import Fastify from "fastify";
import path from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../src/core/mobile/pairing.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { registerSpaFallback } from "../../src/webapp/server-root.js";

const ORIGINAL_HUB_SECRET = process.env.CB_HUB_SECRET;
const ORIGINAL_GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const ORIGINAL_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
process.env.CB_HUB_SECRET = "test-hub-secret-for-mobile-spa-fallback";
// Fake OAuth credentials come as a pair — an ID-without-secret half-config
// is now a loud MissingOAuthClientSecretError at auth-route registration.
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-for-mobile-spa-fallback";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret-for-mobile-spa-fallback";

const box = await makeTmpBox();
const server = Fastify();
registerSpaFallback(server, {
  frontendPath: path.join(PACKAGE_ROOT, "src/frontend/dist"),
  boxes: [{ slug: "test", boxRoot: box.root }],
});

const ticket = createMobilePairingTicket(box.root);
const redeemed = redeemMobilePairingTicket(box.root, {
  pairingToken: ticket.token,
  deviceLabel: "doctest mobile",
});
if (!redeemed) throw new Error("mobile pairing failed");
```

## Unauthenticated SPA fallback is still blocked in hub mode

```ts
const unauthenticated = await server.inject({
  method: "GET",
  url: "/test/chat?embed=1",
});
JSON.stringify({
  status: unauthenticated.statusCode,
  body: unauthenticated.json(),
})
=> {"status":401,"body":{"error":"Not authenticated (hub mode)"}}
```

## A mobile bearer token can load the embedded chat document

```ts continue
const bearerResponse = await server.inject({
  method: "GET",
  url: "/test/chat?embed=1",
  headers: { authorization: `Bearer ${redeemed.deviceToken}` },
});
JSON.stringify({
  status: bearerResponse.statusCode,
  contentType: bearerResponse.headers["content-type"]?.toString().split(";")[0],
})
=> {"status":200,"contentType":"text/html"}
```

## A mobile query token can load the embedded chat document

```ts continue
const queryResponse = await server.inject({
  method: "GET",
  url: `/test/chat?embed=1&mobileToken=${encodeURIComponent(redeemed.deviceToken)}`,
});
JSON.stringify({
  status: queryResponse.statusCode,
  contentType: queryResponse.headers["content-type"]?.toString().split(";")[0],
})
=> {"status":200,"contentType":"text/html"}
```

```ts cleanup
await server.close();
await box.cleanup();
if (ORIGINAL_HUB_SECRET === undefined) delete process.env.CB_HUB_SECRET;
else process.env.CB_HUB_SECRET = ORIGINAL_HUB_SECRET;
if (ORIGINAL_GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
else process.env.GOOGLE_OAUTH_CLIENT_ID = ORIGINAL_GOOGLE_CLIENT_ID;
if (ORIGINAL_GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
else process.env.GOOGLE_OAUTH_CLIENT_SECRET = ORIGINAL_GOOGLE_CLIENT_SECRET;
```

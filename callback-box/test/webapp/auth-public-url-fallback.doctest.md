# `/auth/login`'s redirect URI falls back to the caller's own base URL (Track D, chunk D2)

`registerAuthRoutes` builds its OAuth redirect URI from `getPublicUrl()`,
which needs SOME fallback when neither `CB_PUBLIC_URL` nor `PUBLIC_URL` is
set. The standalone box server's default (`http://localhost:3210`, the dev
router's port) is wrong for `cb hub`, which listens on its own port
(4310 by default, or whatever `hub.json` configures) — without threading
the hub's own base URL in as the fallback, an unconfigured hub's Google
login would round-trip back to a server that was never listening on 3210.
`registerAuthSurface`'s `publicUrlFallback` option (`src/webapp/routes/auth.ts`)
is what lets a caller (the hub, here) override it; omitting it keeps the
standalone box server's behavior exactly as it was.

```ts setup
import Fastify from "fastify";
import { registerAuthSurface } from "../../src/webapp/routes/auth.js";

process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-public-url-fallback-doctest";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-public-url-fallback-doctest";
delete process.env.CB_PUBLIC_URL;
delete process.env.PUBLIC_URL;

async function loginRedirectUri(options) {
  const app = Fastify({ logger: false });
  await registerAuthSurface(app, options);
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/auth/login" });
  await app.close();
  const location = new URL(res.headers.location);
  return location.searchParams.get("redirect_uri");
}
```

## The hub's own base URL is used when `publicUrlFallback` is passed

```ts
await loginRedirectUri({ boxes: [], publicUrlFallback: "http://127.0.0.1:4310" })
=> http://127.0.0.1:4310/auth/callback
```

## Without it, standalone behavior is unchanged (box server's own default)

```ts continue
await loginRedirectUri({ boxes: [] })
=> http://localhost:3210/auth/callback
```

## `CB_PUBLIC_URL`, when set, still wins over either fallback

```ts continue
process.env.CB_PUBLIC_URL = "https://cb.example.org";
await loginRedirectUri({ boxes: [], publicUrlFallback: "http://127.0.0.1:4310" })
=> https://cb.example.org/auth/callback
```

```ts cleanup
delete process.env.CB_PUBLIC_URL;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
```

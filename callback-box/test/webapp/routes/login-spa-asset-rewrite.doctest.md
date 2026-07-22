# The login SPA rewrites its asset base behind a proxy prefix (Track A chunk 2)

`serveLoginSpa` (`src/webapp/routes/auth.ts`) ships the built `dist/index.html`,
whose bundles are referenced by absolute root path (`"/assets/…"`, `"/icons/…"`,
`"/manifest.webmanifest"`, baked by Vite at base="/"). Behind a fronting proxy
that mounts the box under `/<prefix>` (the dev router in dev, the hub for its
children), the browser would request those at the origin root — where the dev
router reads the first segment as a worktree name and 404s, leaving a blank
`#root`. So when the trusted `x-cb-base-prefix` header is present, the served
HTML's asset roots are rewritten to carry the prefix.

With NO header (prod, standalone `cb serve`) the built HTML is served
byte-for-byte — the invariant that keeps prod's asset paths unchanged.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import * as fs from "node:fs";
import * as path from "node:path";

process.env.CB_SESSION_SECRET = "test-session-secret-for-login-spa-rewrite-doctest";

// The exact bytes serveLoginSpa reads off disk, for the byte-identical check.
const rawHtml = fs.readFileSync(path.join(PACKAGE_ROOT, "src/frontend/dist/index.html"), "utf-8");
```

## With a prefix header, every absolute asset root carries the prefix

`GET /auth/login` with `x-cb-base-prefix: /main` rewrites `/assets/`, `/icons/`,
and `/manifest.webmanifest` to `/main/...`, and leaves no bare `"/assets/` root
behind. (The hashes in the built filenames are incidental — we assert the
rewritten roots, not the exact bundle names.)

```ts
const box = await makeTestServer();

const res = await box.server.inject({
  method: "GET",
  url: "/auth/login",
  headers: { "x-cb-base-prefix": "/main" },
});

print(`status: ${res.statusCode}`);
print(`content-type: ${res.headers["content-type"]}`);
print(`has /main/assets/: ${res.payload.includes("/main/assets/")}`);
print(`has /main/icons/: ${res.payload.includes("/main/icons/")}`);
print(`has /main/manifest.webmanifest: ${res.payload.includes("/main/manifest.webmanifest")}`);
// No un-prefixed root survives the rewrite (attribute-anchored `"/assets/`).
print(`bare "/assets/ remains: ${res.payload.includes("\"/assets/")}`);
"done"
=>
status: 200
content-type: text/html
has /main/assets/: true
has /main/icons/: true
has /main/manifest.webmanifest: true
bare "/assets/ remains: false
done
```

## With no header, the served HTML is byte-identical to the built file

The prod / standalone path: no fronting proxy, no header, prefix "" — the built
bytes are served verbatim, so prod's served HTML never changes.

```ts continue
const bare = await box.server.inject({ method: "GET", url: "/auth/login" });
print(`status: ${bare.statusCode}`);
print(`byte-identical to built index.html: ${bare.payload === rawHtml}`);
"done"
=>
status: 200
byte-identical to built index.html: true
done
```

An invalid prefix (traversal) fails the validator safe to "" and also serves
verbatim — a bad header can never rewrite the asset base.

```ts continue
const traversal = await box.server.inject({
  method: "GET",
  url: "/auth/login",
  headers: { "x-cb-base-prefix": "/../etc" },
});
traversal.payload === rawHtml
=> true
```

```ts cleanup
await box.cleanup();
```

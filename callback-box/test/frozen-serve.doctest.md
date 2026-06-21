# Serving frozen page snapshots

`.frozen` captures are untrusted HTML served as `text/html`. The file route
injects a fixed image-fallback script and serves it under a hash-pinned CSP:
`sandbox allow-scripts` keeps the opaque origin, and `script-src 'sha256-…'`
runs only that one script — captured scripts/handlers stay blocked.

```ts setup
import { makeTestServer } from "./helpers/doctest-server.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FROZEN = "<html><head><title>X</title></head><body><img src=\"https://example.com/a.png\"></body></html>";
```

## A frozen page is served with the fallback script + hash-pinned CSP

```ts
const ctx = await makeTestServer();
await mkdir(join(ctx.boxRoot, "store"), { recursive: true });
await writeFile(join(ctx.boxRoot, "store/Page.frozen"), FROZEN);
const res = await ctx.rawRequest({ method: "GET", url: "/api/files/store/Page.frozen" });
res.statusCode
=> 200
```

The CSP sandboxes but allows exactly one hashed script; `nosniff` is set:

```ts continue
res.headers["content-security-policy"]
=> sandbox allow-scripts; script-src '«*»'

res.headers["x-content-type-options"]
=> nosniff
```

The fallback script is injected before `</body>`, and the original image URL is
left intact (hot-linked):

```ts continue
[
  res.payload.includes("/api/proxy-image?url="),
  res.payload.includes("cbProxied"),
  res.payload.includes("https://example.com/a.png"),
  res.payload.indexOf("proxy-image") < res.payload.indexOf("</body>"),
].join(",")
=> true,true,true,true
```

```ts cleanup
await ctx.cleanup();
```

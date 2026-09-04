# `/api/files/*` serves dangerous renderable types as attachments

Track D.1 (architectural review): `/api/files/*` serves any raw box file by
extension-inferred MIME type. A `.html` (or `.svg`) file served inline as
`text/html`/`image/svg+xml` with no `nosniff`/`Content-Disposition` is a
stored-XSS path regardless of how the file got into the box (hand-added,
agent-written, or a legitimate attachment upload) — the fix is at the
*serving* boundary, not an upload allowlist. Dangerous renderable types now
default to `Content-Disposition: attachment` + `X-Content-Type-Options:
nosniff`; the frozen-page capture path (`.frozen`) is the one deliberate
inline-preview exception and keeps its own sandboxed-CSP treatment; ordinary
inert types (images, etc.) gain `nosniff` but stay inline.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { makeTestServer, TEST_SLUG } from "../helpers/doctest-server.js";
import { statusRouter } from "../../src/webapp/trpc/routers/status.js";

const server = await makeTestServer();
```

A `.html` file is forced to download, not render inline:

```ts
await server.seed("_content/page.html", "<html><body><script>alert(1)</script></body></html>");
const html = await server.rawRequest({ method: "GET", url: "/api/files/_content/page.html" });
`${html.statusCode} ${html.headers["content-type"]} ${html.headers["content-disposition"]} ${html.headers["x-content-type-options"]}`
=> 200 text/html attachment; filename="page.html" nosniff
```

An `.svg` file (script-capable when rendered as a document) gets the same
treatment:

```ts continue
await server.seed("_content/mark.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
const svg = await server.rawRequest({ method: "GET", url: "/api/files/_content/mark.svg" });
`${svg.statusCode} ${svg.headers["content-type"]} ${svg.headers["content-disposition"]}`
=> 200 image/svg+xml attachment; filename="mark.svg"
```

The frozen-page capture path keeps its existing inline-preview behavior —
no `Content-Disposition`, and its own sandboxed CSP instead of a bare
`nosniff`-only treatment:

```ts continue
await server.seed("_content/snapshot.frozen", "<html><body>captured page</body></html>");
const frozen = await server.rawRequest({ method: "GET", url: "/api/files/_content/snapshot.frozen" });
`${frozen.statusCode} ${frozen.headers["content-type"]} ${JSON.stringify(frozen.headers["content-disposition"] ?? null)} ${frozen.headers["x-content-type-options"]} ${frozen.headers["content-security-policy"]}`
=> 200 text/html null nosniff sandbox allow-scripts; script-src '«*»'
```

A `304 Not Modified` revalidation repeats the same hardening headers as the
original `200` — a client that cached the file before this fix landed (or
before the file's disposition changed) must not keep reusing a stale,
unhardened cached response forever:

```ts continue
const notModified = await server.rawRequest({
  method: "GET",
  url: "/api/files/_content/page.html",
  headers: { "if-none-match": html.headers.etag },
});
`${notModified.statusCode} ${notModified.headers["content-disposition"]} ${notModified.headers["x-content-type-options"]}`
=> 304 attachment; filename="page.html" nosniff
```

An ordinary inert type (an image) still serves inline, but now also carries
`nosniff`:

```ts continue
await server.seed("_content/photo.jpg", "fake-jpeg-bytes");
const img = await server.rawRequest({ method: "GET", url: "/api/files/_content/photo.jpg" });
`${img.statusCode} ${img.headers["content-type"]} ${JSON.stringify(img.headers["content-disposition"] ?? null)} ${img.headers["x-content-type-options"]}`
=> 200 image/jpeg null nosniff
```

The sibling `/api/image/*` route serves the same box bytes by
extension-inferred MIME type, so it shares the hardening: a `.svg` fetched
through it is forced to download with `nosniff`, not rendered inline
(closing the incomplete-coverage gap the codex review flagged):

```ts continue
const svgImage = await server.rawRequest({ method: "GET", url: "/api/image/_content/mark.svg" });
`${svgImage.statusCode} ${svgImage.headers["content-type"]} ${svgImage.headers["content-disposition"]} ${svgImage.headers["x-content-type-options"]}`
=> 200 image/svg+xml attachment; filename="mark.svg" nosniff
```

An ordinary image through `/api/image/*` stays inline but gains `nosniff`:

```ts continue
const jpgImage = await server.rawRequest({ method: "GET", url: "/api/image/_content/photo.jpg" });
`${jpgImage.statusCode} ${jpgImage.headers["content-type"]} ${JSON.stringify(jpgImage.headers["content-disposition"] ?? null)} ${jpgImage.headers["x-content-type-options"]}`
=> 200 image/jpeg null nosniff
```

## Prefix-collision sibling escape (`/api/image/*`, `status.browse`)

Containment checks must reject a resolved path with a bare `startsWith(root)`
comparison, which a sibling directory sharing the box root's name as a
*prefix* (`<boxRoot>-other`) defeats — `/box-other/x` starts with `/box`. Both
`/api/image/*` and `status.browse` now go through the shared
`containWithinBox` helper (`src/lib/box-containment.ts`), which uses the
strict `=== root || startsWith(root + sep)` form instead.

A normal HTTP client (`fetch`, `curl`, and `light-my-request`'s `inject()`
alike) resolves a literal `../` client-side before the request line is ever
sent — per the URL spec's dot-segment handling — so `server.rawRequest` can't
reach the vulnerable code path with an ordinary request. A raw socket writing
the request line by hand (the way a non-normalizing proxy or a deliberately
crafted client would) can, and is the only way to actually exercise
`containWithinBox`'s prefix-collision branch through the real HTTP route:

```ts continue
const siblingDir = `${server.boxRoot}-other`;
await mkdir(siblingDir, { recursive: true });
await writeFile(join(siblingDir, "secret.jpg"), "sibling-bytes");

await server.server.listen({ port: 0 });
const listenAddr = server.server.server.address();
if (listenAddr === null || typeof listenAddr === "string") {
  throw new Error("expected a bound TCP address");
}
const listenPort = listenAddr.port;

function rawHttpGet(reqPath) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(listenPort, "127.0.0.1", () => {
      sock.write(`GET ${reqPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    sock.on("data", (chunk) => { data += chunk.toString(); });
    sock.on("end", () => resolve(data));
    sock.on("error", reject);
  });
}

const boxDirName = server.boxRoot.split("/").pop();
const escapeImage = await rawHttpGet(`/${TEST_SLUG}/api/image/../${boxDirName}-other/secret.jpg`);
escapeImage.split("\r\n")[0]
=> HTTP/1.1 403 Forbidden
```

```ts continue
escapeImage.split("\r\n\r\n")[1]
=> {"error":"Access denied"}
```

Same prefix-collision check, exercised directly against `status.browse`
(its tRPC input travels as a JSON string, never through URL parsing, so the
sync `containWithinBox` call is reachable with an ordinary `../<sibling>`
path):

```ts continue
const ctx = { boxRoot: server.boxRoot, boxSlug: "t", user: null, authed: true, isOwner: true };
const escapeBrowse = await statusRouter.createCaller(ctx).browse({ path: `../${boxDirName}-other` });
// The box root's own directory name varies per run (a temp dir), so compare
// against the same computed sibling name rather than a fixed literal.
JSON.stringify(escapeBrowse) === JSON.stringify({ path: `../${boxDirName}-other`, dirs: [], cards: [], files: [] })
=> true
```

```ts cleanup
await server.cleanup();
```

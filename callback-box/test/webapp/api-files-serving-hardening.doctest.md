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
import { makeTestServer } from "../helpers/doctest-server.js";

const server = await makeTestServer();
```

A `.html` file is forced to download, not render inline:

```ts
await server.seed("page.html", "<html><body><script>alert(1)</script></body></html>");
const html = await server.rawRequest({ method: "GET", url: "/api/files/page.html" });
`${html.statusCode} ${html.headers["content-type"]} ${html.headers["content-disposition"]} ${html.headers["x-content-type-options"]}`
=> 200 text/html attachment; filename="page.html" nosniff
```

An `.svg` file (script-capable when rendered as a document) gets the same
treatment:

```ts continue
await server.seed("mark.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
const svg = await server.rawRequest({ method: "GET", url: "/api/files/mark.svg" });
`${svg.statusCode} ${svg.headers["content-type"]} ${svg.headers["content-disposition"]}`
=> 200 image/svg+xml attachment; filename="mark.svg"
```

The frozen-page capture path keeps its existing inline-preview behavior —
no `Content-Disposition`, and its own sandboxed CSP instead of a bare
`nosniff`-only treatment:

```ts continue
await server.seed("snapshot.frozen", "<html><body>captured page</body></html>");
const frozen = await server.rawRequest({ method: "GET", url: "/api/files/snapshot.frozen" });
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
  url: "/api/files/page.html",
  headers: { "if-none-match": html.headers.etag },
});
`${notModified.statusCode} ${notModified.headers["content-disposition"]} ${notModified.headers["x-content-type-options"]}`
=> 304 attachment; filename="page.html" nosniff
```

An ordinary inert type (an image) still serves inline, but now also carries
`nosniff`:

```ts continue
await server.seed("photo.jpg", "fake-jpeg-bytes");
const img = await server.rawRequest({ method: "GET", url: "/api/files/photo.jpg" });
`${img.statusCode} ${img.headers["content-type"]} ${JSON.stringify(img.headers["content-disposition"] ?? null)} ${img.headers["x-content-type-options"]}`
=> 200 image/jpeg null nosniff
```

```ts cleanup
await server.cleanup();
```

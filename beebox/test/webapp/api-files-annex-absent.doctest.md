# `/api/files/*` refuses to serve annex pointers as content

Under git-annex an asset whose content is not present locally holds a
~100-byte pointer instead of its bytes. Serving that as the file would produce
a `200` with `Content-Type: image/jpeg` and 101 bytes of text — broken in a way
no client can detect and no log records.

The route bails immediately after `stat`, before any header, ETag, or Range
work, so no code path can describe the pointer as if it were the file.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";

const server = await makeTestServer();

const POINTER =
  "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n";
```

A `GET` for absent content is **409, not 404**: the file exists and is tracked,
its bytes are elsewhere. The response carries what the content should be, so a
caller can report something specific:

```ts
await server.seed("n.attach/photo.jpg", POINTER);
const res = await server.rawRequest({ method: "GET", url: "/api/files/n.attach/photo.jpg" });
const body = JSON.parse(res.payload);
`${res.statusCode} ${body.size} ${body.sha256.slice(0, 12)}`
=> 409 300000 2ee2c7d49384
```

It names the remedy, since the reader is usually an agent deciding what to do
next:

```ts continue
body.hint
=> Fetch it with `git annex get n.attach/photo.jpg`
```

**`HEAD` gets the same treatment.** This is the case worth testing explicitly:
a `HEAD` that fell through would answer `200` with `Content-Length: 101` and an
`ETag` computed from the pointer, so a client would cache the wrong metadata
and never ask for the body:

```ts continue
const head = await server.rawRequest({ method: "HEAD", url: "/api/files/n.attach/photo.jpg" });
const pointerBytes = String(POINTER.length);
`${head.statusCode} describes-pointer=${head.headers["content-length"] === pointerBytes}`
=> 409 describes-pointer=false
```

**A `Range` request cannot slice the pointer.** The probe runs before range
handling, so a byte range over absent content is refused rather than answered
with a `206` carrying a fragment of `/annex/objects/…`:

```ts continue
const ranged = await server.rawRequest({
  method: "GET",
  url: "/api/files/n.attach/photo.jpg",
  headers: { range: "bytes=0-49" },
});
ranged.statusCode
=> 409
```

Present content is unaffected — the probe only ever reads files small enough to
be a pointer, so ordinary serving keeps working:

```ts continue
await server.seed("n.attach/real.txt", "actual file content");
const real = await server.rawRequest({ method: "GET", url: "/api/files/n.attach/real.txt" });
`${real.statusCode} ${real.payload}`
=> 200 actual file content
```

A small text file that merely *starts* with a slash is content, not a pointer —
the predicate fails closed rather than guessing:

```ts continue
await server.seed("n.attach/notes.txt", "/annex/objects/ is where annex keeps things\n");
const notes = await server.rawRequest({ method: "GET", url: "/api/files/n.attach/notes.txt" });
notes.statusCode
=> 200
```

```ts cleanup
await server.cleanup();
```

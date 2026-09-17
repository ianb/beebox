# Chat composer file upload

`POST /api/chat/upload-file` takes one multipart file, writes it into the
box's swept scratch area, and returns the box-relative path the composer
then lists in the message's `<attachments>` block. The path in the response
is the path the file is at: the agent Reads it verbatim, so a response that
named a directory the box does not have (this route once said `tmp/` while
writing to `_tmp/`) is an attachment the agent cannot open.

A `batch` text field, sent ahead of the file, groups every attachment of one
message — files and the originals of inline images alike — into
`_tmp/chat/<batch>/`, where each keeps the name the user gave it. Without it
(an older client) the file lands flat in `_tmp/` under a timestamped name.

```ts setup
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../../helpers/doctest-server.js";

/** A minimal multipart body: an optional `batch` text part, then one `file` part. */
function multipart(opts: { filename: string; mimetype: string; bytes: Buffer; batch?: string }) {
  const boundary = "----bbx-doctest-boundary";
  const batchPart = opts.batch === undefined
    ? ""
    : `--${boundary}\r\nContent-Disposition: form-data; name="batch"\r\n\r\n${opts.batch}\r\n`;
  const head = Buffer.from(
    batchPart +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${opts.filename}"\r\n` +
      `Content-Type: ${opts.mimetype}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, opts.bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
```

## The returned path resolves to the uploaded bytes, unchanged

The bytes are stored as sent: an image's original goes through here too, and
the whole point of keeping it is that it is NOT the reduced inline copy.

```ts
const ctx = await makeTestServer();
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const body = multipart({ filename: "receipt (1).png", mimetype: "image/png", bytes });
const res = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...body });
res.statusCode
=> 200

const uploaded = res.body as { path: string; originalName: string; size: number; mimetype: string };
uploaded.path.startsWith("_tmp/")
=> true

// The filename is sanitized (unsafe characters become `_`), timestamp-
// prefixed, and never contains a path component.
uploaded.path.replace(/\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z/, "<ts>")
=> _tmp/<ts>_receipt__1_.png

JSON.stringify({ originalName: uploaded.originalName, size: uploaded.size, mimetype: uploaded.mimetype })
=> {"originalName":"receipt (1).png","size":14,"mimetype":"image/png"}

(await stat(join(ctx.boxRoot, uploaded.path))).size
=> 14

Buffer.compare(await readFile(join(ctx.boxRoot, uploaded.path)), bytes)
=> 0
```

```ts cleanup
await ctx.cleanup();
```

## No file field is a 400

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/upload-file",
  payload: Buffer.from("------x--\r\n"),
  headers: { "content-type": "multipart/form-data; boundary=----x" },
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

## A batch groups one message's attachments in one directory

Two uploads with the same batch land side by side under `_tmp/chat/<batch>/`,
keeping their own names; a repeated name gets a counter rather than a
timestamp, so the agent reads `IMG_0001.jpg`, not `2026-…Z_IMG_0001.jpg`.

```ts
const ctx = await makeTestServer();
const bytes = Buffer.from("receipt-bytes");
const batch = "m1abcd-x9y8z7w6";
const first = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "IMG_0001.jpg", mimetype: "image/jpeg", bytes, batch }) });
const second = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "notes.txt", mimetype: "text/plain", bytes, batch }) });
const third = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "IMG_0001.jpg", mimetype: "image/jpeg", bytes, batch }) });
JSON.stringify([first.body, second.body, third.body].map((b) => (b as { path: string }).path))
=> ["_tmp/chat/m1abcd-x9y8z7w6/IMG_0001.jpg","_tmp/chat/m1abcd-x9y8z7w6/notes.txt","_tmp/chat/m1abcd-x9y8z7w6/IMG_0001-2.jpg"]

(await readFile(join(ctx.boxRoot, "_tmp/chat/m1abcd-x9y8z7w6/notes.txt"), "utf8"))
=> receipt-bytes
```

A message's uploads run in parallel, and two pasted clipboard images are
both called `image.png`: the name is claimed by the write itself, so neither
clobbers the other.

```ts continue
const race = await Promise.all([1, 2, 3].map((n) =>
  ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "image.png", mimetype: "image/png", bytes: Buffer.from(`copy-${String(n)}`), batch }) })));
const paths = race.map((r) => (r.body as { path: string }).path).sort();
JSON.stringify(paths)
=> ["_tmp/chat/m1abcd-x9y8z7w6/image-2.png","_tmp/chat/m1abcd-x9y8z7w6/image-3.png","_tmp/chat/m1abcd-x9y8z7w6/image.png"]

(await Promise.all(paths.map((p) => readFile(join(ctx.boxRoot, p), "utf8")))).sort().join(",")
=> copy-1,copy-2,copy-3
```

A batch id is a directory name the client minted, never a path: anything
outside `[A-Za-z0-9_-]{8,64}` is refused, not sanitized.

```ts continue
const bad = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "x.txt", mimetype: "text/plain", bytes, batch: "../escape" }) });
JSON.stringify([bad.statusCode, bad.body])
=> [400,{"error":"Invalid batch id"}]
```

```ts cleanup
await ctx.cleanup();
```

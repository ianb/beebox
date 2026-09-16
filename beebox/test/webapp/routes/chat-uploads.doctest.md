# Chat composer file upload

`POST /api/chat/upload-file` takes one multipart file, writes it into the
box's swept scratch area, and returns the box-relative path the composer
then lists in the message's `<attachments>` block. The path in the response
is the path the file is at: the agent Reads it verbatim, so a response that
named a directory the box does not have (this route once said `tmp/` while
writing to `_tmp/`) is an attachment the agent cannot open.

```ts setup
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../../helpers/doctest-server.js";

/** A minimal multipart body with one `file` field. */
function multipart(opts: { filename: string; mimetype: string; bytes: Buffer }) {
  const boundary = "----bbx-doctest-boundary";
  const head = Buffer.from(
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

// # Chat composer file upload
//
// `POST /api/chat/upload-file` takes one multipart file, writes it into the
// box's swept scratch area, and returns the box-relative path the composer
// then lists in the message's `<attachments>` block. The path in the response
// is the path the file is at: the agent Reads it verbatim, so a response that
// named a directory the box does not have (this route once said `tmp/` while
// writing to `_tmp/`) is an attachment the agent cannot open.
//
// A `batch` text field, sent ahead of the file, groups every attachment of one
// message — files and the originals of inline images alike — into
// `_tmp/chat/<batch>/`, where each keeps the name the user gave it. Without it
// (an older client) the file lands flat in `_tmp/` under a timestamped name.

import { test } from "tap";
import "agent-doctest/tap";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { makeTestServer } from "../../../helpers/doctest-server.js";

// The upload route's success body; a failed upload fails the parse rather than yielding `undefined`.
const UploadedFile = z.looseObject({ path: z.string(), originalName: z.string(), size: z.number(), mimetype: z.string() });
const UploadedPath = z.looseObject({ path: z.string() });

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

// ## The returned path resolves to the uploaded bytes, unchanged
//
// The bytes are stored as sent: an image's original goes through here too, and
// the whole point of keeping it is that it is NOT the reduced inline copy.
void test("The bytes are stored as sent:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L46
  const ctx = await makeTestServer();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const body = multipart({ filename: "receipt (1).png", mimetype: "image/png", bytes });
  const res = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...body });
  t.check(res.statusCode, 200);

  // doctest:L53
  const uploaded = UploadedFile.parse(res.body);
  await t.checkText(uploaded.path.startsWith("_tmp/"), "true");

  // doctest:L57
  t.check(
    // The filename is sanitized (unsafe characters become `_`), timestamp-
    // prefixed, and never contains a path component.
    uploaded.path.replace(/\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z/, "<ts>"),
    "_tmp/<ts>_receipt__1_.png",
  );

  // doctest:L62
  t.check({ originalName: uploaded.originalName, size: uploaded.size, mimetype: uploaded.mimetype }, {
    originalName: "receipt (1).png",
    size: 14,
    mimetype: "image/png",
  });

  // doctest:L65
  await t.checkText((await stat(join(ctx.boxRoot, uploaded.path))).size, "14");

  // doctest:L68
  t.check(Buffer.compare(await readFile(join(ctx.boxRoot, uploaded.path)), bytes), 0);
});

// ## No file field is a 400
void test("No file field is a 400", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L79
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/upload-file",
    payload: Buffer.from("------x--\r\n"),
    headers: { "content-type": "multipart/form-data; boundary=----x" },
  });
  t.check(res.statusCode, 400);
});

// ## A batch groups one message's attachments in one directory
//
// Two uploads with the same batch land side by side under `_tmp/chat/<batch>/`,
// keeping their own names; a repeated name gets a counter rather than a
// timestamp, so the agent reads `IMG_0001.jpg`, not `2026-…Z_IMG_0001.jpg`.
void test("Two uploads with the same batch land side by side under tmp/chat/<batch>/, ke...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L101
  const ctx = await makeTestServer();
  const bytes = Buffer.from("receipt-bytes");
  const batch = "m1abcd-x9y8z7w6";
  const first = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "IMG_0001.jpg", mimetype: "image/jpeg", bytes, batch }) });
  const second = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "notes.txt", mimetype: "text/plain", bytes, batch }) });
  const third = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "IMG_0001.jpg", mimetype: "image/jpeg", bytes, batch }) });
  t.check([first.body, second.body, third.body].map((b) => UploadedPath.parse(b).path), [
    "_tmp/chat/m1abcd-x9y8z7w6/IMG_0001.jpg",
    "_tmp/chat/m1abcd-x9y8z7w6/notes.txt",
    "_tmp/chat/m1abcd-x9y8z7w6/IMG_0001-2.jpg",
  ]);

  // doctest:L110
  t.check((await readFile(join(ctx.boxRoot, "_tmp/chat/m1abcd-x9y8z7w6/notes.txt"), "utf8")), "receipt-bytes");

  // A message's uploads run in parallel, and two pasted clipboard images are
  // both called `image.png`: the name is claimed by the write itself, so neither
  // clobbers the other.

  // doctest:L119
  const race = await Promise.all([1, 2, 3].map((n) =>
    ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "image.png", mimetype: "image/png", bytes: Buffer.from(`copy-${String(n)}`), batch }) })));
  const paths = race.map((r) => UploadedPath.parse(r.body).path).toSorted();
  t.check(paths, [
    "_tmp/chat/m1abcd-x9y8z7w6/image-2.png",
    "_tmp/chat/m1abcd-x9y8z7w6/image-3.png",
    "_tmp/chat/m1abcd-x9y8z7w6/image.png",
  ]);

  // doctest:L125
  t.check((await Promise.all(paths.map((p) => readFile(join(ctx.boxRoot, p), "utf8")))).toSorted().join(","), "copy-1,copy-2,copy-3");

  // A batch id is a directory name the client minted, never a path: anything
  // outside `[A-Za-z0-9_-]{8,64}` is refused, not sanitized.

  // doctest:L133
  const bad = await ctx.request({ method: "POST", url: "/api/chat/upload-file", ...multipart({ filename: "x.txt", mimetype: "text/plain", bytes, batch: "../escape" }) });
  t.check([bad.statusCode, bad.body], [
    400,
    {
      error: "Invalid batch id",
    },
  ]);
});

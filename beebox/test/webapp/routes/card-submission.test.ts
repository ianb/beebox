// # `POST /api/cards/submit` — multipart submission intake
//
// The route is a thin multipart shell around `acceptSubmission`
// (`src/core/cards/accept-submission.ts`, covered by its own doctest): stream
// every part to a temp dir, parse the `records` manifest, then hand off. This
// doctest exercises the HTTP boundary — field wiring, JSON parsing, and
// filename rejection — not the acceptance rules themselves.

import { test } from "tap";
import "agent-doctest/tap";
import { any, capture, str } from "agent-doctest/check";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { createBrowserTaskTemplate } from "../../../src/schemas/browser-task.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    permalink: { type: "string" },
    text: { type: "string" },
    photo: { type: "string", format: "attachment" },
  },
  required: ["permalink", "text"],
};

const BOUNDARY = "----doctestBoundary1234567890";

interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  value: string | Buffer;
}

/** Build a raw multipart/form-data body by hand — there is no multipart-client precedent in this test suite. */
function buildMultipart(parts: MultipartPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) header += `; filename="${part.filename}"`;
    header += "\r\n";
    if (part.contentType !== undefined) header += `Content-Type: ${part.contentType}\r\n`;
    header += "\r\n";
    chunks.push(Buffer.from(header, "utf8"));
    chunks.push(typeof part.value === "string" ? Buffer.from(part.value, "utf8") : part.value);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

const MULTIPART_HEADERS = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };

const server = await makeTestServer();
await server.seed(
  "_content/tasks/Task.browser-task.card",
  createBrowserTaskTemplate({
    title: "Pottery Scan",
    start: "https://example.com/feed",
    prompt: "Scan the feed for show announcements.",
  })
);
await server.seed("_content/tasks/Task.attach/schema.json", JSON.stringify(RECORD_SCHEMA, null, 2));

// ## A valid multipart batch is accepted and lands on disk
void test("A valid multipart batch is accepted and lands on disk", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L75
  const validBody = buildMultipart([
    { name: "card", value: "_content/tasks/Task.browser-task.card" },
    {
      name: "records",
      value: JSON.stringify({
        coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-1", reason: "end-of-feed" },
        records: [{ permalink: "https://example.com/feed/post-1", text: "Show announcement", photo: "photo.png" }],
      }),
    },
    { name: "photo.png", filename: "photo.png", contentType: "image/png", value: PNG_BYTES },
  ]);

  // doctest:L87
  const validRes = await server.request({
    method: "POST",
    url: "/api/cards/submit",
    payload: validBody,
    headers: MULTIPART_HEADERS,
  });

  // doctest:L94
  // The batch name is a timestamp plus random hex.
  const batch = capture(any(String).matches(/^\d{8}-\d{6}-[\da-f]{4}$/));
  t.check(validRes, {
    statusCode: 200,
    body: {
      ok: true,
      batch,
      count: 1,
      dir: str`_content/tasks/Task.attach/inbox/${batch}`,
    },
  });

  // doctest:L99
  const batchDir = `_content/tasks/Task.attach/inbox/${batch.value}`;
  t.check((await readdir(join(server.boxRoot, batchDir))).toSorted(), ["photo.png", "records.json"]);

  // ## A `records` part that isn't valid JSON is refused

  // doctest:L107
  const badJsonBody = buildMultipart([
    { name: "card", value: "_content/tasks/Task.browser-task.card" },
    { name: "records", value: "{ not json" },
  ]);

  // doctest:L112
  const badJsonRes = await server.request({
    method: "POST",
    url: "/api/cards/submit",
    payload: badJsonBody,
    headers: MULTIPART_HEADERS,
  });

  // doctest:L119
  t.check(badJsonRes, { statusCode: 400, body: { ok: false, message: "records must be valid JSON" } });

  // ## A file part whose name is a path, not a bare filename, is refused before anything is written

  // doctest:L126
  const pathyBody = buildMultipart([
    { name: "card", value: "_content/tasks/Task.browser-task.card" },
    {
      name: "records",
      value: JSON.stringify({
        coverage: { scanned: 1, stoppedAt: "https://example.com/feed/post-2", reason: "end-of-feed" },
        records: [{ permalink: "https://example.com/feed/post-2", text: "no photo" }],
      }),
    },
    { name: "evil", filename: "../escape.png", contentType: "image/png", value: PNG_BYTES },
  ]);

  // doctest:L138
  const pathyRes = await server.request({
    method: "POST",
    url: "/api/cards/submit",
    payload: pathyBody,
    headers: MULTIPART_HEADERS,
  });

  // doctest:L145
  t.check(pathyRes, {
    statusCode: 400,
    body: {
      ok: false,
      message: "submission failed validation",
      issues: [{ path: "files/escape.png", message: "\"escape.png\" is not referenced by any record" }],
    },
  });

  // Only the one accepted batch from the first case exists under the inbox — the
  // rejected requests never landed a batch:

  // doctest:L153
  t.check(await readdir(join(server.boxRoot, "_content/tasks/Task.attach/inbox")), [batch.value]);

  // ## Two file parts with the same name are refused

  // doctest:L160
  const dupBody = buildMultipart([
    { name: "card", value: "_content/tasks/Task.browser-task.card" },
    { name: "records", filename: "records.json", contentType: "application/json", value: JSON.stringify({ coverage: { scanned: 1, stoppedAt: "x", reason: "end-of-feed" }, records: [] }) },
    { name: "photo.png", filename: "photo.png", contentType: "image/png", value: PNG_BYTES },
    { name: "photo.png", filename: "photo.png", contentType: "image/png", value: PNG_BYTES },
  ]);
  const dup = await server.request({ method: "POST", url: "/api/cards/submit", payload: dupBody, headers: MULTIPART_HEADERS });
  t.check(dup, { statusCode: 400, body: { ok: false, message: "duplicate file name: photo.png" } });
});

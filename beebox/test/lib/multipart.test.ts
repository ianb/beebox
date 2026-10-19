// # Multipart form builder
//
// `buildMultipartForm` is the shared multipart/form-data body builder
// extracted from the Whisper and Voxtral transcription clients — both had
// hand-rolled byte-identical boundary/part framing. Pure: given an ordered
// list of parts, it returns the body bytes and the boundary to put in the
// request's `Content-Type` header.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { buildMultipartForm } from "../../src/lib/multipart.js";

// ## File part + field part, in order
void test("File part + field part, in order", async (t) => {
  const { body, boundary } = buildMultipartForm([
    {
      kind: "file",
      file: { name: "file", filename: "clip.webm", contentType: "audio/webm", data: Buffer.from("AUDIO") },
    },
    { kind: "field", field: { name: "model", value: "whisper-1" } },
  ]);
  const expected =
    `--${boundary}\r\n` +
    "Content-Disposition: form-data; name=\"file\"; filename=\"clip.webm\"\r\n" +
    "Content-Type: audio/webm\r\n\r\n" +
    "AUDIO\r\n" +
    `--${boundary}\r\n` +
    "Content-Disposition: form-data; name=\"model\"\r\n\r\n" +
    "whisper-1\r\n" +
    `--${boundary}--\r\n`;
  t.check(body.toString("utf-8"), expected);

  // Boundary is a fresh random token each call, prefixed `----FormBoundary`:

  t.check(boundary, any(String).matches(/^-{4}FormBoundary[\da-z]+$/));

  const second = buildMultipartForm([]);
  t.check(second.boundary, not(boundary));
});

// ## No parts — just the closing boundary
void test("No parts — just the closing boundary", async (t) => {
  const empty = buildMultipartForm([]);
  t.check(empty.body.toString("utf-8"), `--${empty.boundary}--\r\n`);
});

// ## Field-only parts (no file) preserve given order
void test("Field-only parts (no file) preserve given order", async (t) => {
  const { body: fieldsBody, boundary: fieldsBoundary } = buildMultipartForm([
    { kind: "field", field: { name: "a", value: "1" } },
    { kind: "field", field: { name: "b", value: "2" } },
  ]);
  const fieldsExpected =
    `--${fieldsBoundary}\r\n` +
    "Content-Disposition: form-data; name=\"a\"\r\n\r\n" +
    "1\r\n" +
    `--${fieldsBoundary}\r\n` +
    "Content-Disposition: form-data; name=\"b\"\r\n\r\n" +
    "2\r\n" +
    `--${fieldsBoundary}--\r\n`;
  t.check(fieldsBody.toString("utf-8"), fieldsExpected);
});

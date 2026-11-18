// # Upstream error bodies: read once, truncated
//
// Every HQ transcription arm stores the provider's error body on its
// `TranscriptionError` so the job can classify the failure without re-reading a
// consumed response stream. `truncateUpstreamBody` bounds what gets carried:
// enough to read the provider's reason, not enough to dump megabytes into a
// manifest.
//
// It lives in its own leaf module rather than the `transcription/index.js`
// barrel, which imports the arms — importing it back from the barrel was this
// directory's only *value* import cycle.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readUpstreamErrorBody, truncateUpstreamBody } from "../../../src/core/transcription/upstream-body.js";
import { parseErrorResponse } from "../../../src/core/transcription/voxtral-errors.js";
import { extractHqErrorInput } from "../../../src/core/transcription/dispatch/core.js";
import { classifyHqError } from "../../../src/core/voice-recording/classify.js";

// ## Short bodies pass through unchanged
void test("Short bodies pass through unchanged", async (t) => {
  t.check(truncateUpstreamBody("model unavailable"), "model unavailable");

  t.check(truncateUpstreamBody(""), "");
});

// ## Long bodies are cut to 500 characters
//
// A 600-character body keeps its first 500 characters and nothing else — no
// ellipsis, no suffix, so the result is a strict prefix of the original.
void test("A 600-character body keeps its first 500 characters and nothing else — no ell...", async (t) => {
  const long = "x".repeat(600);
  t.check(truncateUpstreamBody(long), "x".repeat(500));
});

// Exactly 500 is not truncated; 501 is.
void test("Exactly 500 is not truncated; 501 is.", async (t) => {
  t.check(truncateUpstreamBody("y".repeat(500)), "y".repeat(500));

  t.check(truncateUpstreamBody("y".repeat(501)), "y".repeat(500));
});

// ## An error body is read once, whether or not it is JSON
//
// A `Response` body can be read only once. Reading `json()` and then falling
// back to `text()` threw on a plain-text body, and the status went with it.
void test("An error body is read once, whether or not it is JSON", async (t) => {
  t.check(await readUpstreamErrorBody(new Response("Request Entity Too Large", { status: 413 })), {
    text: "Request Entity Too Large",
    json: undefined,
  });
  t.check(await readUpstreamErrorBody(new Response("{\"message\":\"busy\"}", { status: 429 })), {
    text: "{\"message\":\"busy\"}",
    json: { message: "busy" },
  });
});

// ## A plain-text 413 from Voxtral still halves the HQ piece
//
// A proxy in front of the provider can answer 413 with a plain-text body. The
// status must survive parsing so the HQ job classifies the failure
// `piece-too-long` and shortens the piece, instead of resending it
// (plan:transcription-length-limits).
void test("A plain-text 413 from Voxtral still halves the HQ piece", async (t) => {
  const error = await parseErrorResponse(new Response("Request Entity Too Large", { status: 413, statusText: "Payload Too Large" }));
  const input = extractHqErrorInput(error);
  t.check({ input, classification: classifyHqError(input) }, {
    input: { status: 413, body: "Request Entity Too Large", permanent: true },
    classification: "piece-too-long",
  });
});

// A body that cannot be read (the connection dropped after the headers) still
// leaves the status, so a 413 halves rather than resending the same piece.
void test("An unreadable 413 body still halves the HQ piece", async (t) => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("connection reset")); } });
  const error = await parseErrorResponse(new Response(stream, { status: 413 }));
  t.check(classifyHqError(extractHqErrorInput(error)), "piece-too-long");
});

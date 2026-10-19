// # Upstream error-body truncation
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
import { truncateUpstreamBody } from "../../../src/core/transcription/upstream-body.js";

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

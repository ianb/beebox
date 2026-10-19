// # HQ error classification
//
// `classifyHqError` sorts one HQ transcription attempt's failure into
// `"transient"`, `"permanent"`, or `"piece-too-long"`, so the job knows whether
// to retry with backoff, halve the piece and restart, or give up.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { classifyHqError } from "../../../src/core/voice-recording/classify.js";

// ## No response at all (network error/timeout) is transient
void test("No response at all (network error/timeout) is transient", async (t) => {
  // doctest:L14
  t.check(classifyHqError({}), "transient");
});

// ## 429 is transient; other 4xx are permanent
void test("429 is transient; other 4xx are permanent", async (t) => {
  // doctest:L21
  t.check(classifyHqError({ status: 429 }), "transient");

  // doctest:L24
  t.check(classifyHqError({ status: 401 }), "permanent");

  // doctest:L27
  t.check(classifyHqError({ status: 400 }), "permanent");
});

// ## 5xx is transient, except 501
void test("5xx is transient, except 501", async (t) => {
  // doctest:L34
  t.check(classifyHqError({ status: 500 }), "transient");

  // doctest:L37
  t.check(classifyHqError({ status: 501 }), "permanent");
});

// ## 408 is piece-too-long regardless of body
void test("408 is piece-too-long regardless of body", async (t) => {
  // doctest:L44
  t.check(classifyHqError({ status: 408 }), "piece-too-long");
});

// ## A 503 is piece-too-long only when the body names `diarization_unavailable`
//
// This is MAI-Transcribe-2's documented too-long-to-diarize answer; an ordinary
// 503 (provider down) is transient so it gets retried instead of halved:
void test("This is MAI-Transcribe-2's documented too-long-to-diarize answer; an ordinary...", async (t) => {
  // doctest:L54
  t.check(classifyHqError({ status: 503, body: JSON.stringify({ error: "diarization_unavailable" }) }), "piece-too-long");

  // doctest:L57
  t.check(classifyHqError({ status: 503 }), "transient");

  // doctest:L60
  t.check(classifyHqError({ status: 503, body: "Service Unavailable" }), "transient");
});

// ## A status-less error's own `permanent` flag decides it
//
// `MissingOpenRouterKeyError` throws before any HTTP request happens — no
// status, but its `TranscriptionError` shape carries `permanent: true`:
void test("MissingOpenRouterKeyError throws before any HTTP request happens — no status,...", async (t) => {
  // doctest:L70
  t.check(classifyHqError({ permanent: true }), "permanent");

  // doctest:L73
  t.check(classifyHqError({ permanent: false }), "transient");
});

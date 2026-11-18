// # Voice recording piece planning
//
// `planPieces` cuts a recording's concatenated 16 kHz mono s16le PCM into byte
// ranges of at most `pieceSeconds` each, on sample (2-byte) boundaries.
// `hqPieceSeconds` is a service's starting piece length, from its length
// limits. `nextPieceSeconds` halves the piece length toward the floor, and
// `shorterPieceSeconds` halves until a retry sends less audio. `joinPieceWords`
// puts each piece's word times on the whole recording's timeline.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { HQ_TRANSCRIPTION_SERVICES } from "../../../../src/shared/transcription-services.js";
import { planPieces, nextPieceSeconds, shorterPieceSeconds, hqPieceSeconds, joinPieceWords, HQ_PIECE_FLOOR_SECONDS, PCM_BYTES_PER_SECOND } from "../../../../src/core/voice-recording/hq-job/pieces.js";

// The 300 s piece every OpenRouter-reachable service starts at.
const OPENROUTER_PIECE_SECONDS = 300;

// ## A recording shorter than one piece is a single piece
void test("A recording shorter than one piece is a single piece", async (t) => {
  const totalBytes = PCM_BYTES_PER_SECOND * 60;
  t.check(planPieces(totalBytes, OPENROUTER_PIECE_SECONDS), [
    {
      startByte: 0,
      endByte: 1920000,
    },
  ]);
});

// ## A recording longer than one piece splits into consecutive, non-overlapping ranges
//
// 10 minutes (600s) of audio at the default 300s piece length is exactly two
// pieces:
void test("10 minutes (600s) of audio at the default 300s piece length is exactly two pi...", async (t) => {
  const tenMinutes = PCM_BYTES_PER_SECOND * 600;
  t.check(planPieces(tenMinutes, OPENROUTER_PIECE_SECONDS), [
    {
      startByte: 0,
      endByte: 9600000,
    },
    {
      startByte: 9600000,
      endByte: 19200000,
    },
  ]);
});

// A length that doesn't divide evenly leaves a shorter final piece — still
// sample-aligned, since every full piece is already an even number of bytes:
void test("A length that doesn't divide evenly leaves a shorter final piece — still samp...", async (t) => {
  // 420s = one 300s piece + a 120s remainder
  const sevenMinutes = PCM_BYTES_PER_SECOND * 420;
  t.check(planPieces(sevenMinutes, OPENROUTER_PIECE_SECONDS), [
    {
      startByte: 0,
      endByte: 9600000,
    },
    {
      startByte: 9600000,
      endByte: 13440000,
    },
  ]);
});

// ## Zero bytes produces zero pieces
void test("Zero bytes produces zero pieces", async (t) => {
  t.check(planPieces(0, OPENROUTER_PIECE_SECONDS), []);
});

// ## `nextPieceSeconds` halves toward the floor, then returns null
void test("`nextPieceSeconds` halves toward the floor, then returns null", async (t) => {
  t.check(nextPieceSeconds(OPENROUTER_PIECE_SECONDS), 150);

  t.check(nextPieceSeconds(HQ_PIECE_FLOOR_SECONDS), null);
});

// A piece length already below the floor also yields `null` (halving only ever
// moves further from a usable length):
void test("A piece length already below the floor also yields null (halving only ever mo...", async (t) => {
  t.check(nextPieceSeconds(100), null);
});

// A half that falls below the floor becomes the floor, so a long starting
// length still tries 150 s once before giving up (3600 → … → 225 → 150):
void test("A half below the floor becomes the floor once", async (t) => {
  t.check(nextPieceSeconds(225), 150);
});

// ## Each service starts at the smallest of its length limits
//
// The Whisper family can go through OpenRouter, whose 300 s JSON-body limit is
// smaller than OpenAI's direct 25 MB upload (781 s of WAV). MAI is OpenRouter
// only. Voxtral is Mistral direct: 60 minutes (plan:transcription-length-limits).
void test("Each service starts at the smallest of its length limits", async (t) => {
  t.check(HQ_TRANSCRIPTION_SERVICES.map((service) => [service, hqPieceSeconds(service)]), [
    ["whisper", 300],
    ["whisper-llm", 300],
    ["whisper-llm-mini", 300],
    ["voxtral", 3600],
    ["voxtral-diarized", 3600],
    ["mai", 300],
    ["mai-diarized", 300],
  ]);
});

// ## An hour plans one piece; one sample more plans two
void test("An hour plans one piece; one sample more plans two", async (t) => {
  const hour = PCM_BYTES_PER_SECOND * 3600;
  t.check(planPieces(hour, 3600), [{ startByte: 0, endByte: 115200000 }]);
  t.check(planPieces(hour + 2, 3600), [
    { startByte: 0, endByte: 115200000 },
    { startByte: 115200000, endByte: 115200002 },
  ]);
});

// ## A retry after a too-long piece sends less audio than the rejected piece
//
// A 600 s recording rejected at a 3600 s piece length would be resent whole at
// 1800 and 900; the retry goes straight to 450. A 200 s recording at 300 still
// goes to 150, and a 120 s one has nowhere shorter to go.
void test("A retry after a too-long piece sends less audio than the rejected piece", async (t) => {
  t.check(
    [
      shorterPieceSeconds({ current: 3600, rejectedSeconds: 600 }),
      shorterPieceSeconds({ current: 300, rejectedSeconds: 200 }),
      shorterPieceSeconds({ current: 300, rejectedSeconds: 120 }),
    ],
    [450, 150, null],
  );
});

// ## Word times shift by their piece's start
//
// A service times each word from the start of the piece it was sent; the
// second 300 s piece's word at 1.5 s is 301.5 s into the recording.
void test("Word times shift by their piece's start", async (t) => {
  const second = PCM_BYTES_PER_SECOND * OPENROUTER_PIECE_SECONDS;
  t.check(joinPieceWords([
    { startByte: 0, words: [{ word: "hello", start: 0.5, end: 0.9 }] },
    { startByte: second, words: [{ word: "again", start: 1.5, end: 2 }] },
  ]), [
    { start: 0.5, end: 0.9, text: "hello" },
    { start: 301.5, end: 302, text: "again" },
  ]);
});

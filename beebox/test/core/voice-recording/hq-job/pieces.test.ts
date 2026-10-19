// # Voice recording piece planning
//
// `planPieces` cuts a recording's concatenated 16 kHz mono s16le PCM into byte
// ranges of at most `pieceSeconds` each, on sample (2-byte) boundaries.
// `nextPieceSeconds` halves the piece length toward the floor.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { planPieces, nextPieceSeconds, HQ_PIECE_SECONDS, HQ_PIECE_FLOOR_SECONDS, PCM_BYTES_PER_SECOND } from "../../../../src/core/voice-recording/hq-job/pieces.js";

// ## A recording shorter than one piece is a single piece
void test("A recording shorter than one piece is a single piece", async (t) => {
  const totalBytes = PCM_BYTES_PER_SECOND * 60;
  t.check(planPieces(totalBytes, HQ_PIECE_SECONDS), [
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
  t.check(planPieces(tenMinutes, HQ_PIECE_SECONDS), [
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
  t.check(planPieces(sevenMinutes, HQ_PIECE_SECONDS), [
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
  t.check(planPieces(0, HQ_PIECE_SECONDS), []);
});

// ## `nextPieceSeconds` halves toward the floor, then returns null
void test("`nextPieceSeconds` halves toward the floor, then returns null", async (t) => {
  t.check(nextPieceSeconds(HQ_PIECE_SECONDS), 150);

  t.check(nextPieceSeconds(HQ_PIECE_FLOOR_SECONDS), null);
});

// A piece length already below the floor also yields `null` (halving only ever
// moves further from a usable length):
void test("A piece length already below the floor also yields null (halving only ever mo...", async (t) => {
  t.check(nextPieceSeconds(100), null);
});

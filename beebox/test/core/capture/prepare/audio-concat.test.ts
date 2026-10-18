// # Per-segment audio concatenation
//
// `concatSegments` joins each recording segment's chunks independently. Only the
// first chunk of a recording carries the WebM/EBML header, so chunks are
// concatenated *within* a segment (never across), yielding one buffer per segment
// with chunk order preserved.

import { test } from "tap";
import "agent-doctest/tap";
import { concatSegments } from "../../../../src/core/capture/prepare/audio-concat.js";

// ## Two segments, three chunks each → two buffers, order preserved
void test("Two segments, three chunks each → two buffers, order preserved", async (t) => {
  // doctest:L15
  const out = concatSegments([
    {
      segmentId: "seg-a",
      startedAt: "2026-07-09T14:00:00.000Z",
      chunks: [Buffer.from("A0"), Buffer.from("A1"), Buffer.from("A2")],
    },
    {
      segmentId: "seg-b",
      startedAt: "2026-07-09T14:05:00.000Z",
      chunks: [Buffer.from("B0"), Buffer.from("B1"), Buffer.from("B2")],
    },
  ]);
  await t.checkText(out.length, "2");

  // doctest:L30
  t.check(out[0]?.segmentId, "seg-a");

  // doctest:L33
  t.check(out[0]?.buffer.toString("utf-8"), "A0A1A2");

  // doctest:L36
  t.check(out[1]?.segmentId, "seg-b");

  // doctest:L39
  t.check(out[1]?.buffer.toString("utf-8"), "B0B1B2");
});

// ## Empty segments are dropped
//
// A segment that recorded no chunks produces no card:
void test("A segment that recorded no chunks produces no card:", async (t) => {
  // doctest:L48
  const out = concatSegments([
    { segmentId: "empty", startedAt: "2026-07-09T14:00:00.000Z", chunks: [] },
    { segmentId: "real", startedAt: "2026-07-09T14:01:00.000Z", chunks: [Buffer.from("X")] },
  ]);
  await t.checkText(out.length, "1");

  // doctest:L55
  t.check(out[0]?.segmentId, "real");
});

// ## A truncated tail chunk still concatenates (decodable prefix, no throw)
//
// A crash mid-recording can leave the last chunk cut to half its bytes (the tail
// since the last `dataavailable` is lost). Concat is pure byte-join, so it returns
// a buffer carrying the full prefix plus whatever survived — never throwing:
void test("A crash mid-recording can leave the last chunk cut to half its bytes (the tai...", async (t) => {
  // doctest:L66
  const header = Buffer.from("HEADER-cluster0-cluster1-");
  const truncatedTail = Buffer.from("cluster2-HALF").subarray(0, 8); // "cluster2" — cut mid-chunk
  const out = concatSegments([
    { segmentId: "seg-a", startedAt: "2026-07-09T14:00:00.000Z", chunks: [header, truncatedTail] },
  ]);
  await t.checkText(out.length, "1");

  // doctest:L74
  t.check(out[0]?.buffer.toString("utf-8"), "HEADER-cluster0-cluster1-cluster2");
});

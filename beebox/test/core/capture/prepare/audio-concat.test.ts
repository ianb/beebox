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
  t.check(out.map((seg) => ({ ...seg, buffer: seg.buffer.toString("utf-8") })), [
    { segmentId: "seg-a", startedAt: "2026-07-09T14:00:00.000Z", buffer: "A0A1A2" },
    { segmentId: "seg-b", startedAt: "2026-07-09T14:05:00.000Z", buffer: "B0B1B2" },
  ]);
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
  t.check(out.map((seg) => ({ ...seg, buffer: seg.buffer.toString("utf-8") })), [
    { segmentId: "real", startedAt: "2026-07-09T14:01:00.000Z", buffer: "X" },
  ]);
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
  t.check(out.map((seg) => ({ ...seg, buffer: seg.buffer.toString("utf-8") })), [
    { segmentId: "seg-a", startedAt: "2026-07-09T14:00:00.000Z", buffer: "HEADER-cluster0-cluster1-cluster2" },
  ]);
});

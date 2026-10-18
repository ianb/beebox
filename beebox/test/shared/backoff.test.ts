// # Backoff helpers
//
// `jitteredBackoff` is full-jitter exponential backoff: a random delay in
// `[0, min(capMs, baseMs·2^(attempt-1))]`. Deterministic behavior — the ceiling
// itself, and clamping at the cap — is what's worth pinning down; the random
// draw is exercised by bounds-checking many samples.

import { test } from "tap";
import "agent-doctest/tap";
import { jitteredBackoff } from "../../src/shared/backoff.js";

// ## The ceiling grows exponentially with attempt, then clamps at the cap
void test("The ceiling grows exponentially with attempt, then clamps at the cap", async (t) => {
  // doctest:L15
  const opts = { baseMs: 1000, capMs: 8000 };
  // attempt 1: ceiling = 1000, attempt 2: 2000, attempt 3: 4000, attempt 4: 8000 (== cap),
  // attempt 5 would be 16000 but clamps to the 8000 cap.
  const samples = [1, 2, 3, 4, 5].map((attempt) => {
    const draws = Array.from({ length: 200 }, () => jitteredBackoff(attempt, opts));
    return Math.max(...draws);
  });
  await t.checkText(
    // Every draw for a given attempt is <= that attempt's ceiling, and attempt 5's
    // max observed draw cannot exceed the cap even though its un-clamped ceiling
    // (16000) would allow it.
    JSON.stringify(samples.map((max, i) => max <= ([1000, 2000, 4000, 8000, 8000][i] ?? -1))),
    "[true,true,true,true,true]",
  );

  // Every draw is non-negative:

  // doctest:L32
  const anyNegative = Array.from({ length: 200 }, () => jitteredBackoff(3, opts)).some((v) => v < 0);
  t.check(anyNegative, false);
});

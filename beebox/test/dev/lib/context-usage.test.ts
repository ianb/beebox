// # Context-size accounting
//
// `summarizeContextUsage` reduces an audit's per-turn token usage into the numbers
// the knowledge-audit report shows: the always-on **baseline** (first turn), the
// **peak** loaded context, how much answering **added**, and the turn count.

import { test } from "tap";
import "agent-doctest/tap";
import { loadedContextTokens, summarizeContextUsage } from "../../../src/dev/lib/context-usage.js";

// The loaded context of a turn sums all three input components — never just
// input_tokens, which prompt caching leaves tiny.
const turn = ([inputTokens, cacheCreationInputTokens, cacheReadInputTokens]: [number, number, number]) => ({
  inputTokens, cacheCreationInputTokens, cacheReadInputTokens,
});

// ## Loaded context sums input + cache-creation + cache-read
//
// With caching, `input_tokens` alone (5) wildly undercounts the real 41,172 the
// turn actually loaded.
void test("With caching, inputtokens alone (5) wildly undercounts the real 41,172 the tu...", async (t) => {
  // doctest:L23
  t.check(loadedContextTokens(turn([5, 24456, 16711])), 41172);
});

// ## Baseline, peak, and added across a multi-turn answer
//
// The first turn is the baseline; later turns grow as tool-reads accumulate. Peak
// is the max, added is `peak − initial`.
void test("The first turn is the baseline; later turns grow as tool-reads accumulate.", async (t) => {
  // doctest:L33
  const stats = summarizeContextUsage([
    turn([5, 38534, 0]),     // turn 0 — baseline 38,539
    turn([10, 0, 38539]),    // turn 1 — flat (cached), 38,549
    turn([20, 4445, 38539]), // turn 2 — grew to 43,004
    turn([50, 16064, 43004]),// turn 3 — peak 59,118
  ]);
  t.check(stats, {
    initialTokens: 38539,
    peakTokens: 59118,
    addedTokens: 20579,
    turnCount: 4,
  });
});

// ## A single-turn answer adds nothing
//
// When there's only the baseline turn, peak equals initial and added is zero — the
// report collapses this to just the baseline.
void test("When there's only the baseline turn, peak equals initial and added is zero —...", async (t) => {
  // doctest:L49
  t.check(summarizeContextUsage([turn([5, 24456, 16711])]), {
    initialTokens: 41172,
    peakTokens: 41172,
    addedTokens: 0,
    turnCount: 1,
  });
});

// ## No turns yields null
//
// An empty or unreadable session has nothing to report.
void test("An empty or unreadable session has nothing to report.", async (t) => {
  // doctest:L58
  t.check(summarizeContextUsage([]), null);
});

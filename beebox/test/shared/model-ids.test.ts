// # Canonical model IDs
//
// `normalizeModelId` carries a retired model ID forward to its current
// replacement, so a persisted chat selection or a box procedure card that still
// names Opus 4.8 (or a `[1m]` context variant Claude Code no longer exposes) keeps
// working. Model-policy admission normalizes persisted values, and `agent/run.ts`
// provides the final boundary for raw procedure-card IDs.

import { test } from "tap";
import "agent-doctest/tap";
import { MODEL_ID, normalizeModelId } from "../../src/shared/model-ids.js";

// ## Retired IDs translate forward
//
// Opus 5, Opus 4.8, and the old `[1m]` variant fold into Opus 5.5; the Fable
// `[1m]` variant folds into Fable 5.1 (1M context is native to the 5-tier).
void test("Opus 5, Opus 4.8, and the old [1m] variant fold into Opus 5.5; the Fable [1m]...", async (t) => {
  // doctest:L19
  t.check(normalizeModelId("claude-opus-5"), "claude-opus-5-5");

  // doctest:L22
  t.check(normalizeModelId("claude-opus-4-8"), "claude-opus-5-5");

  // doctest:L25
  t.check(normalizeModelId("claude-opus-4-8[1m]"), "claude-opus-5-5");

  // doctest:L28
  t.check(normalizeModelId("claude-fable-5[1m]"), "claude-fable-5-1");
});

// Sonnet 5 folds into Sonnet 5.5 and Haiku 4.5 into Haiku 5.5, the models the
// `sonnet` and `haiku` aliases now name.
void test("Sonnet 5 folds into Sonnet 5.5 and Haiku 4.5 into Haiku 5.5, the models the s...", async (t) => {
  // doctest:L36
  t.check(normalizeModelId("claude-sonnet-5"), "claude-sonnet-5-5");

  // doctest:L39
  t.check(MODEL_ID.sonnet, "claude-sonnet-5-5");

  // doctest:L42
  t.check(normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-5-5");

  // doctest:L45
  t.check(MODEL_ID.haiku, "claude-haiku-5-5");
});

// Fable 5 itself is retired the same way: a chat or procedure card that pinned
// it keeps working on Fable 5.1.
void test("Fable 5 itself is retired the same way:", async (t) => {
  // doctest:L53
  t.check(normalizeModelId("claude-fable-5"), "claude-fable-5-1");
});

// GPT-5.6 Luna moves to GPT-6 Luna; GPT-5.6 Sol and GPT-6 Sol move to GPT-6.1
// Sol. Terra stays on GPT-5.6 because GPT-6 has no Terra tier.
void test("GPT-5.6 Luna moves to GPT-6 Luna; GPT-5.6 Sol and GPT-6 Sol move to GPT-6.1 Sol.", async (t) => {
  // doctest:L61
  t.check(
    [
      normalizeModelId("gpt-5.6-luna"),
      normalizeModelId("gpt-5.6-sol"),
      normalizeModelId("gpt-6-sol"),
      normalizeModelId("gpt-5.6-terra"),
    ],
    [
    "gpt-6-luna",
    "gpt-6.1-sol",
    "gpt-6.1-sol",
    "gpt-5.6-terra",
  ],
  );
});

// ## Live IDs pass through unchanged
void test("Live IDs pass through unchanged", async (t) => {
  // doctest:L73
  await t.checkText(normalizeModelId(MODEL_ID.sonnet) === MODEL_ID.sonnet, "true");
});

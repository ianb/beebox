// # Knowledge-audit report — context baselines
//
// The report opens with a context-baseline summary and annotates each audit's
// baseline with its change since the prior run, so a trim shows up as a number
// rather than a YAML diff you go find.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ContextHistoryEntry } from "../../../src/dev/lib/context-history.js";
import { formatBaselineDelta, renderContextSummary } from "../../../src/dev/lib/report.js";
import type { TestResult } from "../../../src/dev/lib/test-runner/runner/run-test.js";

// A result with everything empty except what renderContextSummary reads:
// test.id and behavior.context. A null context means the audit measured no usage.
const res = (id: string, initialTokens: number | null): TestResult => ({
  test: { id, prompt: id, expected_level: "knows_about", watch_for: id },
  engine: "claude",
  sessionId: "session",
  behavior: {
    filesRead: [],
    searches: [],
    bashCommands: [],
    bashRawCommands: [],
    responseText: "",
    replyText: "",
    responseLength: 0,
    context: initialTokens === null ? null : { initialTokens, peakTokens: initialTokens, addedTokens: 0, turnCount: 1 },
  },
  checks: {
    containsChecks: [],
    matchesChecks: [],
    notContainsChecks: [],
    notMatchesChecks: [],
    cardsContainChecks: [],
    cardsNotUnderChecks: [],
    shouldReadChecks: [],
    shouldNotReadChecks: [],
    bashContainsChecks: [],
  },
});
const prior = (initial: number): ContextHistoryEntry[] => [{ date: "d", boxCommit: "b", repoCommit: "r", initial, peak: initial, added: 0, turns: 1 }];

// ## The delta clause compares a baseline to the prior run
void test("The delta clause compares a baseline to the prior run", async (t) => {
  t.check(formatBaselineDelta(38000, 41000), "; -3k from last run");

  t.check(formatBaselineDelta(41000, 38000), "; +3k from last run");

  // Sub-1k drift is noise at the report's 1k resolution, and a first run has no
  // prior to compare against.

  t.check(formatBaselineDelta(41200, 41000), "; ~same as last run");

  t.check(formatBaselineDelta(41000, undefined), "");
});

// ## The summary table sorts baselines high→low with per-audit deltas
//
// `alpha` shrank 3k since its last run; `beta` has no prior entry, so its delta is
// blank. Rows are ordered by baseline, biggest first.
void test("alpha shrank 3k since its last run; beta has no prior entry, so its delta is...", async (t) => {
  const out = renderContextSummary([res("beta", 38000), res("alpha", 41000)], { alpha: prior(44000) });
  // The lowest baseline is called out as the cleanest estimate of the pure
  // always-on tier.
  t.check(out, [
    "## Context baselines",
    "",
    "| Audit | Initial | Δ last run |",
    "|---|--:|--:|",
    "| alpha | 41k | -3k |",
    "| beta | 38k | — |",
    "",
    "Lowest baseline ≈ pure always-on tier: 38k (`beta`).",
    "",
  ]);
});

// ## No measured context → no summary section
void test("No measured context → no summary section", async (t) => {
  t.check(renderContextSummary([res("x", null)], {}), []);
});

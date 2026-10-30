// # One tone per commit phase
//
// The commit list, the commit detail and the dashboard activity all colour a
// commit's `Phase` trailer through this one map, so a phase reads the same
// everywhere. Phases the map does not know render neutral.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { phaseTone } from "../../../src/components/history/phase-tone.js";

void test("phases from both vocabularies have one tone each", async (t) => {
  t.check(
    ["intake", "transcribe", "describe-images", "triage", "refresh", "summarize", "plan-extraction", "assemble", "extract", "analyze", "archive", "brief"].map(phaseTone),
    ["info", "info", "info", "info", "info", "warning", "warning", "warning", "warning", "warning", "success", "success"],
  );
});

void test("an unknown phase is neutral, including names on the object prototype", async (t) => {
  t.check(["nonsense", "", "constructor", "toString"].map(phaseTone), ["neutral", "neutral", "neutral", "neutral"]);
});

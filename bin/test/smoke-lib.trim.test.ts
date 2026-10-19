// # The smoke report's trim footer
//
// `bin/smoke --report` ends by naming the steps that have never failed in 20
// or more runs. It used to add up their p50 times as the cost of every walk.
// That total is not what a trim saves: one named step was the page load the
// next step reads from. The footer now names candidates and says what to check
// before trimming one, with no seconds figure.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { formatSmokeReport, summarizeSmokeLog } from "../smoke-lib.js";

const run = () =>
  JSON.stringify({
    ts: "2026-09-09T10:00:00.000Z",
    commit: "abc",
    branch: "worktree-x",
    worktree: "x",
    box: "test1",
    verdict: "green",
    ms: 27_000,
    steps: [
      { id: "browse-list", outcome: "ok", ms: 3_300 },
      { id: "page-errors", outcome: "ok", ms: 500 },
    ],
  });

// The footer names the clean steps and asks for the check a log cannot make.
void test("The footer names the clean steps and asks for the check a log cannot make.", async (t) => {
  const report = formatSmokeReport(
    summarizeSmokeLog(Array.from({ length: 25 }, run)),
  );
  const footer = report.slice(report.indexOf("Never failed"));
  t.check(footer.split("\n").slice(0, 4), [
    "Never failed in 20+ runs: browse-list, page-errors.",
    "A clean record makes a step a candidate, not a trim: check in bin/smoke.ts",
    "that an earlier step already catches what it checks, and that no later step",
    "relies on it. Its p50 is not what a trim recovers.",
  ]);
});

// The footer states no seconds total. The step table above it still shows
// each step's p50.
void test("The footer states no seconds total.", async (t) => {
  const report = formatSmokeReport(
    summarizeSmokeLog(Array.from({ length: 25 }, run)),
  );
  const footer = report.slice(report.indexOf("Never failed"));
  t.check(
    {
      footerHasSeconds: /\d\.\ds/.test(footer),
      tableHasP50: report.includes("3.3s"),
    },
    {
      footerHasSeconds: false,
      tableHasP50: true,
    },
  );
});

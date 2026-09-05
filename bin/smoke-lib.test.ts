import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSmokeReport,
  summarizeSmokeLog,
  type SmokeRunRecord,
} from "./smoke-lib.js";

// ── the run log ─────────────────────────────────────────────────────────────

const RUN = (over: Partial<SmokeRunRecord>): string =>
  JSON.stringify({
    ts: "2026-08-26T12:00:00.000Z",
    commit: "abc",
    branch: "worktree-x",
    worktree: "x",
    box: "test1",
    verdict: "green",
    ms: 27000,
    steps: [
      { id: "cold-start", outcome: "ok", ms: 2500 },
      { id: "place-menu", outcome: "ok", ms: 3700 },
    ],
    ...over,
  } satisfies SmokeRunRecord);

test("summarizeSmokeLog: a step's denominator is the runs it actually ran in", () => {
  // The walk stops at the first failure. Counting the later step as a pass in
  // the run it never reached is exactly the arithmetic that would get it
  // trimmed for "never failing".
  const summary = summarizeSmokeLog([
    RUN({}),
    RUN({
      verdict: "red",
      failedStep: "cold-start",
      steps: [
        { id: "cold-start", outcome: "fail", ms: 31000 },
        { id: "place-menu", outcome: "not-run", ms: 0 },
      ],
    }),
  ]);
  assert.equal(summary.runs, 2);
  assert.equal(summary.red, 1);
  const cold = summary.steps.find((s) => s.id === "cold-start");
  const menu = summary.steps.find((s) => s.id === "place-menu");
  assert.deepEqual({ ran: cold?.ran, failed: cold?.failed }, { ran: 2, failed: 1 });
  assert.deepEqual({ ran: menu?.ran, failed: menu?.failed }, { ran: 1, failed: 0 });
  assert.equal(cold?.lastFailure, "2026-08-26T12:00:00.000Z");
  assert.equal(menu?.lastFailure, null);
});

test("summarizeSmokeLog: a truncated final line does not lose the whole log", () => {
  // A run killed mid-append leaves a partial line; the report still has to work.
  const summary = summarizeSmokeLog([RUN({}), '{"ts":"2026-08-26T13:00', ""]);
  assert.equal(summary.runs, 1);
});

test("summarizeSmokeLog: steps read in walk order, by first appearance", () => {
  assert.deepEqual(
    summarizeSmokeLog([RUN({})]).steps.map((s) => s.id),
    ["cold-start", "place-menu"],
  );
});

test("formatSmokeReport: no trim advice until a clean record means something", () => {
  const oneRun = formatSmokeReport(summarizeSmokeLog([RUN({})]));
  assert.match(oneRun, /1 run logged/);
  assert.doesNotMatch(oneRun, /Never caught anything/);

  const many = formatSmokeReport(summarizeSmokeLog(Array.from({ length: 25 }, () => RUN({}))));
  assert.match(many, /25 runs logged/);
  assert.match(many, /Never caught anything in 20\+ runs/);
  assert.match(many, /cold-start, place-menu/);
});

test("formatSmokeReport: an empty log says so rather than printing a bare table", () => {
  assert.match(formatSmokeReport(summarizeSmokeLog([])), /no runs logged yet/);
});

test("summarizeSmokeLog: a fault-injected run is counted apart from every rate", () => {
  // The first weekly review read a deliberately broken run as a real
  // intermittent "worth a second look if it recurs". Folding an ordered
  // failure into `failed` is what made that reading possible.
  const summary = summarizeSmokeLog([
    RUN({}),
    RUN({
      verdict: "red",
      faultInjected: "hub throws at import",
      failedStep: "cold-start",
      steps: [
        { id: "cold-start", outcome: "fail", ms: 31000 },
        { id: "place-menu", outcome: "not-run", ms: 0 },
      ],
    }),
  ]);
  assert.equal(summary.runs, 1);
  assert.equal(summary.red, 0);
  assert.equal(summary.injectedRuns, 1);
  const cold = summary.steps.find((s) => s.id === "cold-start");
  assert.deepEqual(
    { ran: cold?.ran, failed: cold?.failed, injected: cold?.injected },
    { ran: 1, failed: 0, injected: 1 },
  );
  // And its 31s timeout must not drag the median: p50 is what the step costs
  // when it works.
  assert.equal(cold?.medianSeconds, 2.5);
  assert.equal(cold?.lastFailure, null);
});

test("formatSmokeReport: forced failures are shown, and never counted as caught", () => {
  const report = formatSmokeReport(
    summarizeSmokeLog([
      ...Array.from({ length: 25 }, () => RUN({})),
      RUN({
        verdict: "red",
        faultInjected: "hub throws at import",
        failedStep: "cold-start",
        steps: [{ id: "cold-start", outcome: "fail", ms: 31000 }],
      }),
    ]),
  );
  assert.match(report, /1 fault-injected run excluded from every count below/);
  assert.match(report, /forced/);
  // cold-start fired only on demand, so it still reads as never having caught
  // anything — which is the honest thing for a trim decision to see.
  assert.match(report, /Never caught anything in 20\+ runs[\S\s]*cold-start/);
});

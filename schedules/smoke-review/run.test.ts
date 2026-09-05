import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSmokeLog } from "../../bin/smoke-lib.ts";
import {
  formatBriefing,
  hasSomethingToReview,
  parseBaseline,
  partitionBugs,
  windowStart,
  type Evidence,
} from "./lib.ts";

const EMPTY = summarizeSmokeLog([]);

function evidence(over: Partial<Evidence>): Evidence {
  return {
    windowStart: "2026-08-19T00:00:00.000Z",
    windowEnd: "2026-08-26T00:00:00.000Z",
    allTime: EMPTY,
    window: EMPTY,
    failures: [],
    injected: [],
    landings: [],
    bugs: [],
    ...over,
  };
}

test("windowStart: from the last review, so a missed week is reviewed, not skipped", () => {
  const now = new Date("2026-08-26T00:00:00.000Z");
  assert.equal(
    windowStart({ baseline: { reviewedAt: "2026-08-05T00:00:00.000Z", runs: 12 }, now, cadenceDays: 7 }),
    "2026-08-05T00:00:00.000Z",
  );
});

test("windowStart: with no baseline, one cadence — not all of history", () => {
  // Reviewing everything on a first run would sweep in every bug ever filed
  // and make the gap half unreadable.
  assert.equal(
    windowStart({ baseline: null, now: new Date("2026-08-26T00:00:00.000Z"), cadenceDays: 7 }),
    "2026-08-19T00:00:00.000Z",
  );
});

test("hasSomethingToReview: either half can be the whole product", () => {
  assert.equal(hasSomethingToReview(evidence({})), false);
  assert.equal(
    hasSomethingToReview(evidence({ window: { runs: 3, red: 0, injectedRuns: 0, steps: [] } })),
    true,
  );
  // No smoke runs at all, but bugs were filed — the gap half still has work.
  assert.equal(
    hasSomethingToReview(
      evidence({ bugs: [{ path: "issues/bugs/x.md", title: "t", closed: false }] }),
    ),
    true,
  );
});

test("hasSomethingToReview: a quiet week says nothing at all", () => {
  // Landings alone are not a trigger: if none of them ran the walk and nothing
  // was filed, there is no evidence to review and a report would be noise.
  assert.equal(
    hasSomethingToReview(evidence({ landings: [{ commit: "abc1234", subject: "docs: x" }] })),
    false,
  );
});

test("parseBaseline: a malformed baseline is absent, not fatal", () => {
  assert.deepEqual(parseBaseline('{"reviewedAt":"2026-08-19T00:00:00.000Z","runs":4}'), {
    reviewedAt: "2026-08-19T00:00:00.000Z",
    runs: 4,
  });
  assert.equal(parseBaseline('{"reviewedAt":'), null);
  assert.equal(parseBaseline('{"runs":4}'), null);
  assert.equal(parseBaseline("null"), null);
});

test("formatBriefing: evidence and provenance, with no verdict of its own", () => {
  const briefing = formatBriefing(
    evidence({
      window: { runs: 5, red: 1, injectedRuns: 0, steps: [] },
      failures: [
        { ts: "2026-08-24T10:00:00.000Z", step: "cold-start", message: "the box failed to start", commit: "deadbeefcafe" },
      ],
      bugs: [{ path: "issues/bugs/2026-08-24-thing.md", title: "The menu dies", closed: false }],
    }),
  );
  assert.match(briefing, /cold-start/);
  assert.match(briefing, /deadbeef/);
  assert.match(briefing, /The menu dies/);
  // The script must not characterise its own findings — that is the session's
  // job, and a script that starts ranking is one that will be wrong unattended.
  assert.doesNotMatch(briefing, /consider|recommend|should be trimmed|unproductive/i);
});

test("partitionBugs: the hourly run's own issues lead, everything else follows", () => {
  const bugs = [
    { path: "a.md", title: "Full-suite red after feat(chat): x: 2 test files failing", closed: true },
    { path: "b.md", title: "A pasted WebP was rejected", closed: false },
  ];
  const { regressions, others } = partitionBugs(bugs);
  assert.deepEqual(regressions.map((b) => b.path), ["a.md"]);
  assert.deepEqual(others.map((b) => b.path), ["b.md"]);
});

test("partitionBugs: a renamed full-suite title degrades to `others`, never vanishes", () => {
  // The match is on a title another schedule writes. If that wording changes,
  // the row must lose its prominence, not its existence.
  const bugs = [{ path: "a.md", title: "Suite went red after feat(chat): x", closed: false }];
  const { regressions, others } = partitionBugs(bugs);
  assert.equal(regressions.length, 0);
  assert.deepEqual(others.map((b) => b.path), ["a.md"]);
});

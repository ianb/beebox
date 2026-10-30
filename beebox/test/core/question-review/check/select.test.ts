// # Which questions the daily question review takes up
//
// A put-away question with no box decision qualifies after 3 days; a pending
// one after 14. An answered, expired, or decided question never does, and a
// question reviewed in the last 14 days is skipped. The oldest wait comes
// first and a run takes at most 5.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  selectQuestionsForReview,
  type ReviewCandidate,
} from "../../../../src/core/question-review/check/select.js";

const NOW = new Date("2026-10-26T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function candidate(overrides: Partial<ReviewCandidate> & { path: string }): ReviewCandidate {
  return {
    prompt: `Prompt of ${overrides.path}`,
    state: "pending",
    askedAt: daysAgo(1),
    dismissedAt: undefined,
    hasProvisional: false,
    ...overrides,
  };
}

function select(candidates: ReviewCandidate[], reviewed: Record<string, string>) {
  return selectQuestionsForReview({ candidates, reviewed, now: NOW }).map((q) => q.path);
}

// ## A put-away question qualifies at 3 days, a pending one at 14
void test("A put-away question qualifies at 3 days, a pending one at 14", async (t) => {
  t.check(select([
    candidate({ path: "dismissed-2", state: "dismissed", dismissedAt: daysAgo(2.9) }),
    candidate({ path: "dismissed-3", state: "dismissed", dismissedAt: daysAgo(3) }),
    candidate({ path: "pending-13", askedAt: daysAgo(13.9) }),
    candidate({ path: "pending-14", askedAt: daysAgo(14) }),
  ], {}), ["pending-14", "dismissed-3"]);
});

// ## Answered, expired, decided, and dateless questions never qualify
void test("Answered, expired, decided, and dateless questions never qualify", async (t) => {
  t.check(select([
    candidate({ path: "answered", state: "answered", askedAt: daysAgo(90) }),
    candidate({ path: "expired", state: "expired", askedAt: daysAgo(90) }),
    candidate({ path: "decided", state: "dismissed", dismissedAt: daysAgo(30), hasProvisional: true }),
    candidate({ path: "pending-no-date", askedAt: undefined }),
    candidate({ path: "dismissed-no-date", state: "dismissed", dismissedAt: undefined }),
  ], {}), []);
});

// ## A question reviewed within 14 days is skipped
void test("A question reviewed within 14 days is skipped", async (t) => {
  const candidates = [
    candidate({ path: "recent", askedAt: daysAgo(40) }),
    candidate({ path: "old", askedAt: daysAgo(30) }),
    candidate({ path: "unlatched", askedAt: daysAgo(20) }),
  ];
  t.check(select(candidates, { recent: daysAgo(13), old: daysAgo(14) }), ["old", "unlatched"]);
});

// ## Oldest wait first, then path, capped at 5
void test("Oldest wait first, then path, capped at 5", async (t) => {
  const many = ["a", "b", "c", "d", "e", "f", "g"].map((path, i) =>
    candidate({ path, askedAt: daysAgo(15 + i) }),
  );
  t.check(select(many, {}), ["g", "f", "e", "d", "c"]);

  t.check(select([
    candidate({ path: "b", askedAt: daysAgo(20) }),
    candidate({ path: "a", askedAt: daysAgo(20) }),
    candidate({ path: "put-away", state: "dismissed", dismissedAt: daysAgo(25) }),
  ], {}), ["put-away", "a", "b"]);
});

// # Quota room and the Codex reviewer pick
//
// `bin/cross-model-run` picks Astra only when the weekly Codex window has
// room: use behind the clock by 15 points, or a first-day window with at most
// 10% used. Everything else, an unreadable quota included, picks Sol.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { pickCodexReviewModel, summarizeCosts, windowRoom } from "../../lib/quota-room.js";

const RESET = "2026-11-01T00:00:00.000Z";
const DAY = 86_400_000;
/** `days` into the week that resets at RESET. */
const at = (days: number): Date => new Date(new Date(RESET).getTime() - (7 - days) * DAY);

const weekly = (usedPercent: number) => ({ label: "7-day window", usedPercent, resetsAt: RESET, durationMinutes: 10_080 });
const codex = (usedPercent: number) =>
  ({ provider: "codex" as const, status: "available" as const, fetchedAt: RESET, windows: [weekly(usedPercent)] });

void test("windowRoom: 3.5 days in with 20% used is 50% elapsed, 30 points of room, 40% at reset", async (t) => {
  t.check(windowRoom(weekly(20), at(3.5)), {
    label: "7-day window", usedPercent: 20, elapsedPercent: 50, room: 30, projectedPercent: 40, resetsAt: RESET,
  });
});

void test("windowRoom has no pace in the first day, and none for a window without a duration", async (t) => {
  t.check(windowRoom(weekly(2), at(0.5))?.projectedPercent, null);
  t.check(windowRoom({ label: "Extra usage", usedPercent: 100, resetsAt: RESET, durationMinutes: null }, at(3)), null);
});

void test("pick: each branch of the rule", async (t) => {
  const pick = (used: number, days: number): string => pickCodexReviewModel(codex(used), at(days)).model;
  t.check({
    // 50% elapsed − 35% used = 15 points, exactly the threshold.
    roomAtThreshold: pick(35, 3.5),
    // 14 points of room.
    roomJustUnder: pick(36, 3.5),
    // First day, 10% used: pace unknown and use low.
    earlyLow: pick(10, 0.5),
    // First day, 11% used: already spending fast.
    earlyHigh: pick(11, 0.5),
  }, { roomAtThreshold: "gpt-6-astra", roomJustUnder: "gpt-6-sol", earlyLow: "gpt-6-astra", earlyHigh: "gpt-6-sol" });
});

void test("pick: an unreadable quota picks Sol and says why", async (t) => {
  const quota = { provider: "codex" as const, status: "unavailable" as const, fetchedAt: RESET, windows: [], message: "not logged in" };
  t.check(pickCodexReviewModel(quota, at(3)), { model: "gpt-6-sol", reason: "no Codex 7-day window (not logged in)" });
});

void test("pick reads the general weekly window, never another pool's", async (t) => {
  // Halfway through the week the general window at 40% has 10 points of room
  // (Sol); a named pool at 0% would have 50 (Astra).
  const quota = { ...codex(40), windows: [{ ...weekly(0), label: "other-pool · 7-day window" }, weekly(40)] };
  t.check(pickCodexReviewModel(quota, at(3.5)).model, "gpt-6-sol");
});

void test("summarizeCosts averages by model and drops a row whose window reset mid-run", async (t) => {
  const NEXT = "2026-11-08T00:00:00.000Z";
  const row = (model: string, [usedBefore, usedAfter, resetsAfter]: [number, number, string?]) => ({
    at: RESET, model, effort: "high", outcome: "answered" as const, seconds: 300,
    usedBefore, usedAfter, resetsBefore: RESET, resetsAfter: resetsAfter ?? RESET,
  });
  t.check(summarizeCosts([row("gpt-6-sol", [10, 11]), row("gpt-6-sol", [11, 11]), row("gpt-6-astra", [40, 43]), row("gpt-6-astra", [1, 2, NEXT])]), [
    // The 1 → 2 row spans a reset (its reset time moved), so Astra has one run of 3 points.
    { model: "gpt-6-astra", runs: 1, meanPoints: 3 },
    { model: "gpt-6-sol", runs: 2, meanPoints: 0.5 },
  ]);
});

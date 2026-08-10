import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  collectAgentQuotas,
  parseClaudeQuota,
  parseCodexQuota,
  quotaPace,
  requestCodexRateLimits,
} from "./agent-quotas.js";

test("Codex quotas prefer the named Codex bucket and retain window duration", () => {
  const quota = parseCodexQuota(
    {
      rateLimits: { primary: { usedPercent: 99, resetsAt: 1_800 } },
      rateLimitsByLimitId: {
        codex: {
          limitName: "Codex",
          primary: {
            usedPercent: 20,
            resetsAt: 1_786_826_452,
            windowDurationMins: 60,
          },
          secondary: {
            usedPercent: 30,
            resetsAt: 1_786_996_067,
            windowDurationMins: 10_080,
          },
          credits: { balance: "12.50", unlimited: false },
        },
        codex_spark: {
          limitName: "Codex Spark",
          primary: {
            usedPercent: 5,
            resetsAt: 604_800,
            windowDurationMins: 10_080,
          },
        },
      },
    },
    "1970-01-01T00:00:00.000Z",
  );
  assert.equal(quota.status, "available");
  assert.deepEqual(
    quota.windows.map(({ usedPercent, durationMinutes }) => ({
      usedPercent,
      durationMinutes,
    })),
    [
      { usedPercent: 20, durationMinutes: 60 },
      { usedPercent: 30, durationMinutes: 10_080 },
      { usedPercent: 5, durationMinutes: 10_080 },
    ],
  );
  assert.deepEqual(
    quota.windows.map(({ label }) => label),
    ["1-hour window", "7-day window", "Codex Spark · 7-day window"],
  );
  assert.deepEqual(quota.credits, { balance: "12.50", unlimited: false });
  assert.equal(quota.windows[0]?.resetsAt, "2026-08-15T20:40:52.000Z");
});

test("Claude quotas infer durations for documented windows", () => {
  const quota = parseClaudeQuota({
    rate_limits: {
      five_hour: { used_percentage: 12, resets_at: 18_000 },
      seven_day: { used_percentage: 25, resets_at: "1970-01-08T00:00:00Z" },
    },
  });
  assert.deepEqual(
    quota.windows.map(({ label, durationMinutes }) => ({
      label,
      durationMinutes,
    })),
    [
      { label: "5-hour window", durationMinutes: 300 },
      { label: "7-day window", durationMinutes: 10_080 },
    ],
  );
});

test("pace compares usage with the fraction of the window elapsed", () => {
  const window = {
    label: "7-day window",
    usedPercent: 20,
    resetsAt: "2026-08-08T00:00:00.000Z",
    durationMinutes: 7 * 24 * 60,
  };
  const pace = quotaPace(window, new Date("2026-08-03T00:00:00.000Z"));
  assert.ok(pace);
  assert.equal(Math.round(pace.expectedPercent), 29);
  assert.equal(Math.round(pace.differencePoints), 9);
  assert.equal(pace.onTrack, true);
});

test("collectors fail independently and retain cached Claude capture time", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
  await fs.writeFile(
    path.join(stateDir, "claude-rate-limits.json"),
    JSON.stringify({
      captured_at: "2026-08-01T00:00:00Z",
      rate_limits: {
        five_hour: { used_percentage: 40, resets_at: 1_786_000_000 },
      },
    }),
  );
  const quotas = await collectAgentQuotas({
    stateDir,
    now: new Date("2026-08-10T00:00:00Z"),
    codexRequest: async () => {
      throw new Error("not logged in");
    },
  });
  assert.equal(quotas[0]?.fetchedAt, "2026-08-01T00:00:00Z");
  assert.equal(quotas[0]?.status, "available");
  assert.equal(quotas[0]?.stale, true);
  assert.equal(quotas[1]?.status, "unavailable");
  assert.equal(quotas[1]?.message, "not logged in");
});

test("a missing Codex binary rejects without an unhandled stdin error", async () => {
  await assert.rejects(
    requestCodexRateLimits(1_000, "definitely-not-a-real-codex-command"),
    /ENOENT/,
  );
});

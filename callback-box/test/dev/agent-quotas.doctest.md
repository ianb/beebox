# Agent quota collection

The workstreams dashboard presents Claude and Codex usage through one normalized
shape. Provider-specific parsing retains each window's duration so the UI can
compare actual usage with the fraction of the window that has elapsed.

```ts setup
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CLAUDE_CACHE_MS,
  collectAgentQuotas,
  parseClaudeQuota,
  parseCodexQuota,
  quotaPace,
  requestCodexRateLimits,
} from "../../../bin/agent-quotas.js";
```

## Provider payloads

Codex may return a generic bucket alongside named limit buckets. The named
Codex bucket is authoritative, and model-specific limits remain visible.

```ts
const codexQuota = parseCodexQuota(
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
JSON.stringify({
  status: codexQuota.status,
  windows: codexQuota.windows,
  credits: codexQuota.credits,
})
=> {"status":"available","windows":[{"label":"1-hour window","usedPercent":20,"resetsAt":"2026-08-15T20:40:52.000Z","durationMinutes":60},{"label":"7-day window","usedPercent":30,"resetsAt":"2026-08-17T19:47:47.000Z","durationMinutes":10080},{"label":"Codex Spark · 7-day window","usedPercent":5,"resetsAt":"1970-01-08T00:00:00.000Z","durationMinutes":10080}],"credits":{"balance":"12.50","unlimited":false}}
```

Claude's historical status-line payload and current SDK payload use different
percentage fields. Both parse, and the SDK's model-scoped weekly limits are
preserved.

```ts
const legacyClaude = parseClaudeQuota({
  rate_limits: {
    five_hour: { used_percentage: 12, resets_at: 18_000 },
    seven_day: { used_percentage: 25, resets_at: "1970-01-08T00:00:00Z" },
  },
});
JSON.stringify(legacyClaude.windows.map(({ label, durationMinutes }) => ({
  label,
  durationMinutes,
})))
=> [{"label":"5-hour window","durationMinutes":300},{"label":"7-day window","durationMinutes":10080}]

const sdkClaude = parseClaudeQuota({
  rate_limits: {
    five_hour: { utilization: 12, resets_at: "2026-08-11T00:20:00Z" },
    seven_day: { utilization: 54, resets_at: "2026-08-14T20:00:00Z" },
    model_scoped: [{
      display_name: "Fable",
      utilization: 61,
      resets_at: "2026-08-14T20:00:00Z",
    }],
  },
});
JSON.stringify(sdkClaude.windows.map(({ label, usedPercent }) => ({
  label,
  usedPercent,
})))
=> [{"label":"5-hour window","usedPercent":12},{"label":"7-day window","usedPercent":54},{"label":"Fable · 7-day window","usedPercent":61}]
```

Pace is the difference between quota used and elapsed window time. With two of
seven days elapsed, 20% usage is nine percentage points ahead of pace.

```ts
const pace = quotaPace({
  label: "7-day window",
  usedPercent: 20,
  resetsAt: "2026-08-08T00:00:00.000Z",
  durationMinutes: 7 * 24 * 60,
}, new Date("2026-08-03T00:00:00.000Z"));
JSON.stringify({
  expectedPercent: Math.round(pace!.expectedPercent),
  differencePoints: Math.round(pace!.differencePoints),
  onTrack: pace!.onTrack,
})
=> {"expectedPercent":29,"differencePoints":9,"onTrack":true}
```

## Ten-minute Claude cache

A fresh persistent cache suppresses SDK work. Claude and Codex failures remain
independent, and a failed refresh retains a stale Claude snapshot with its
original capture time.

```ts
const staleDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(staleDir, { recursive: true, force: true }));
await fs.writeFile(path.join(staleDir, "claude-rate-limits.json"), JSON.stringify({
  captured_at: "2026-08-01T00:00:00Z",
  rate_limits: {
    five_hour: { used_percentage: 40, resets_at: 1_786_000_000 },
  },
}));
const staleQuotas = await collectAgentQuotas({
  claudeRequest: async () => { throw new Error("SDK unavailable"); },
  stateDir: staleDir,
  now: new Date("2026-08-10T00:00:00Z"),
  codexRequest: async () => { throw new Error("not logged in"); },
});
JSON.stringify({
  claude: {
    fetchedAt: staleQuotas[0]?.fetchedAt,
    status: staleQuotas[0]?.status,
    stale: staleQuotas[0]?.stale,
  },
  codex: {
    status: staleQuotas[1]?.status,
    message: staleQuotas[1]?.message,
  },
})
=> {"claude":{"fetchedAt":"2026-08-01T00:00:00Z","status":"available","stale":true},"codex":{"status":"unavailable","message":"not logged in"}}

const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(freshDir, { recursive: true, force: true }));
const capturedAt = "2026-08-10T00:00:00Z";
await fs.writeFile(path.join(freshDir, "claude-rate-limits.json"), JSON.stringify({
  captured_at: capturedAt,
  rate_limits: {
    five_hour: { utilization: 10, resets_at: "2026-08-10T05:00:00Z" },
  },
}));
let freshRequests = 0;
const freshQuotas = await collectAgentQuotas({
  claudeRequest: async () => {
    freshRequests += 1;
    throw new Error("must not refresh");
  },
  codexRequest: async () => ({}),
  now: new Date(new Date(capturedAt).getTime() + CLAUDE_CACHE_MS - 1),
  stateDir: freshDir,
});
JSON.stringify({
  requests: freshRequests,
  status: freshQuotas[0]?.status,
  stale: freshQuotas[0]?.stale,
})
=> {"requests":0,"status":"available","stale":false}
```

Concurrent readers in one process share a single SDK request.

```ts
const sharedDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(sharedDir, { recursive: true, force: true }));
let sharedRequests = 0;
const sharedOptions = {
  claudeRequest: async () => {
    sharedRequests += 1;
    return {
      rate_limits_available: true,
      rate_limits: {
        five_hour: {
          utilization: 15,
          resets_at: "2026-08-10T05:00:00Z",
        },
      },
    };
  },
  codexRequest: async () => ({}),
  now: new Date("2026-08-10T00:00:00Z"),
  stateDir: sharedDir,
};
const sharedResults = await Promise.all([
  collectAgentQuotas(sharedOptions),
  collectAgentQuotas(sharedOptions),
]);
JSON.stringify({
  requests: sharedRequests,
  first: sharedResults[0]?.[0]?.windows[0]?.usedPercent,
  second: sharedResults[1]?.[0]?.windows[0]?.usedPercent,
})
=> {"requests":1,"first":15,"second":15}
```

Failures are negative-cached for the same ten-minute cadence, including when no
successful snapshot exists yet. Repeated reads therefore do not spawn a Claude
subprocess every time the dashboard refreshes.

```ts
const failureDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(failureDir, { recursive: true, force: true }));
let failedRequests = 0;
const failureOptions = {
  claudeRequest: async () => {
    failedRequests += 1;
    throw new Error("Claude login required");
  },
  codexRequest: async () => ({}),
  now: new Date("2026-08-10T00:00:00Z"),
  stateDir: failureDir,
};
const firstFailure = await collectAgentQuotas(failureOptions);
const repeatedFailure = await collectAgentQuotas(failureOptions);
JSON.stringify({
  requests: failedRequests,
  first: firstFailure[0]?.message,
  repeated: repeatedFailure[0]?.message,
})
=> {"requests":1,"first":"Claude login required","repeated":"Claude login required"}
```

A malformed capture timestamp cannot make an old payload look fresh. A
successful refresh replaces it, writes a private file, and leaves no temporary
siblings behind.

```ts
const malformedDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(malformedDir, { recursive: true, force: true }));
const malformedPath = path.join(malformedDir, "claude-rate-limits.json");
await fs.writeFile(malformedPath, JSON.stringify({
  captured_at: "not-a-date",
  rate_limits: {
    five_hour: { utilization: 99, resets_at: "2026-08-10T05:00:00Z" },
  },
}));
let malformedRequests = 0;
const refreshed = await collectAgentQuotas({
  claudeRequest: async () => {
    malformedRequests += 1;
    return {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 33, resets_at: "2026-08-10T05:00:00Z" },
      },
    };
  },
  codexRequest: async () => ({}),
  now: new Date("2026-08-10T00:00:00Z"),
  stateDir: malformedDir,
});
const mode = (await fs.stat(malformedPath)).mode & 0o777;
const siblings = await fs.readdir(malformedDir);
JSON.stringify({
  requests: malformedRequests,
  used: refreshed[0]?.windows[0]?.usedPercent,
  mode: mode.toString(8),
  files: siblings,
})
=> {"requests":1,"used":33,"mode":"600","files":["claude-rate-limits.json"]}
```

Dashboard reads never wait on a missing Claude cache. They initiate the shared
refresh and return an unavailable result immediately; a blocking CLI reader can
join that same pending request.

```ts
const backgroundDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-quotas-"));
t.teardown(async () => await fs.rm(backgroundDir, { recursive: true, force: true }));
type UsageResult = {
  rate_limits_available: boolean;
  rate_limits: {
    seven_day: { utilization: number; resets_at: string };
  };
};
let finishRequest!: (value: UsageResult) => void;
const backgroundRequest = async () => await new Promise<UsageResult>((resolve) => {
  finishRequest = resolve;
});
const backgroundOptions = {
  claudeRequest: backgroundRequest,
  codexRequest: async () => ({}),
  now: new Date("2026-08-10T00:00:00Z"),
  stateDir: backgroundDir,
};
const initial = await collectAgentQuotas({
  ...backgroundOptions,
  backgroundClaudeRefresh: true,
});
assert.equal(initial[0]?.status, "unavailable");
assert.match(initial[0]?.message ?? "", /refreshing/);

const completed = collectAgentQuotas(backgroundOptions);
finishRequest({
  rate_limits_available: true,
  rate_limits: {
    seven_day: { utilization: 22, resets_at: "2026-08-17T00:00:00Z" },
  },
});
(await completed)[0]?.windows[0]?.usedPercent
=> 22
```

Finally, a missing Codex executable rejects cleanly instead of surfacing an
unhandled stdin error.

```ts
await assert.rejects(
  requestCodexRateLimits(1_000, "definitely-not-a-real-codex-command"),
  /ENOENT/,
);
```

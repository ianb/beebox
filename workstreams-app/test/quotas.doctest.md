# Workstreams quota collection

The app parses the two providers into one UI-facing quota shape without
depending on router-owned modules.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectAgentQuotas } from "../src/server/quota-collect.js";
import { parseClaudeQuota, parseCodexQuota } from "../src/server/quota-parse.js";
import { quotaSummaryText, quotaWindowsForDisplay } from "../src/frontend/lib/format.js";

const fetchedAt = "2026-08-13T12:00:00.000Z";
```

## Provider payloads retain windows, model scopes, and credits

```ts
const codex = parseCodexQuota({
  rateLimits: {
    limitName: "Codex",
    primary: {
      usedPercent: 25,
      resetsAt: Date.parse("2026-08-20T12:00:00.000Z") / 1_000,
      windowDurationMins: 10_080,
    },
    credits: { balance: "42", unlimited: false },
  },
}, fetchedAt);
const claude = parseClaudeQuota({
  rate_limits: {
    seven_day: { utilization: 35, resets_at: "2026-08-20T12:00:00.000Z" },
    model_scoped: [{
      display_name: "Sonnet",
      utilization: 10,
      resets_at: "2026-08-20T12:00:00.000Z",
    }],
  },
}, fetchedAt);
JSON.stringify({
  codex: { status: codex.status, windows: codex.windows, credits: codex.credits },
  claude: { status: claude.status, windows: claude.windows },
})
=> {"codex":{"status":"available","windows":[{"label":"7-day window","usedPercent":25,"resetsAt":"2026-08-20T12:00:00.000Z","durationMinutes":10080}],"credits":{"balance":"42","unlimited":false}},"claude":{"status":"available","windows":[{"label":"7-day window","usedPercent":35,"resetsAt":"2026-08-20T12:00:00.000Z","durationMinutes":10080},{"label":"Sonnet · 7-day window","usedPercent":10,"resetsAt":"2026-08-20T12:00:00.000Z","durationMinutes":10080}]}}
```

Claude's short window is secondary in the panel even when the provider returns
it first. Other providers retain their source order.

```ts
const short = { label: "5-hour window", usedPercent: 10, resetsAt: fetchedAt, durationMinutes: 300 };
const weekly = { label: "7-day window", usedPercent: 20, resetsAt: fetchedAt, durationMinutes: 10_080 };
JSON.stringify({
  claude: quotaWindowsForDisplay({ provider: "claude", status: "available", fetchedAt, windows: [short, weekly] }).map((window) => window.label),
  codex: quotaWindowsForDisplay({ provider: "codex", status: "available", fetchedAt, windows: [short, weekly] }).map((window) => window.label),
})
=> {"claude":["7-day window","5-hour window"],"codex":["5-hour window","7-day window"]}
```

## Provider summaries use only meaningful weekly quotas

Short-window tanks and Codex model-specific tanks remain visible in the panel,
but they cannot mark the provider headline over pace.

```ts
const summaryNow = new Date("2026-08-20T16:41:00.000Z");
const codexQuota = {
  provider: "codex" as const,
  status: "available" as const,
  fetchedAt,
  windows: [
    { label: "7-day window", usedPercent: 6, resetsAt: "2026-08-27T04:36:00.000Z", durationMinutes: 10_080 },
    { label: "GPT-5.3-Codex-Spark · 5-hour window", usedPercent: 0, resetsAt: "2026-08-20T21:41:00.000Z", durationMinutes: 300 },
    { label: "GPT-5.3-Codex-Spark · 7-day window", usedPercent: 69, resetsAt: "2026-08-25T16:37:00.000Z", durationMinutes: 10_080 },
  ],
};
quotaSummaryText(codexQuota, summaryNow)
=> on track
```

Claude's general and Fable weekly quotas collapse when they agree and name the
disagreement when they do not.

```ts
const claudeSummaryNow = new Date("2026-08-20T16:41:00.000Z");
const claudeSummaryQuota = {
  provider: "claude" as const,
  status: "available" as const,
  fetchedAt,
  windows: [
    { label: "7-day window", usedPercent: 6, resetsAt: "2026-08-27T04:36:00.000Z", durationMinutes: 10_080 },
    { label: "Fable · 7-day window", usedPercent: 69, resetsAt: "2026-08-25T16:37:00.000Z", durationMinutes: 10_080 },
  ],
};
const agreeingClaude = { ...claudeSummaryQuota, windows: claudeSummaryQuota.windows.map((window) => ({ ...window, usedPercent: 6 })) };
JSON.stringify({ disagree: quotaSummaryText(claudeSummaryQuota, claudeSummaryNow), agree: quotaSummaryText(agreeingClaude, claudeSummaryNow) })
=> {"disagree":"general on track, Fable over pace","agree":"on track"}
```

## Collection observes the ten-minute Claude cadence

A panel-open foreground collection persists Claude quota data, and a second
collection inside the cadence reuses that snapshot. Codex keeps its shorter
in-memory polling cadence.

```ts
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-quota-"));
let claudeRequests = 0;
let codexRequests = 0;
const claudeRequest = async () => {
  claudeRequests++;
  return {
    rate_limits_available: true,
    rate_limits: {
      seven_day: { utilization: 20, resets_at: "2026-08-20T12:00:00.000Z" },
    },
  };
};
const codexRequest = async () => {
  codexRequests++;
  return {
    rateLimits: {
      primary: {
        usedPercent: 15,
        resetsAt: Date.parse("2026-08-20T12:00:00.000Z") / 1_000,
        windowDurationMins: 10_080,
      },
    },
  };
};
const first = await collectAgentQuotas({
  stateDir,
  now: new Date(fetchedAt),
  claudeRequest,
  codexRequest,
});
const second = await collectAgentQuotas({
  stateDir,
  now: new Date("2026-08-13T12:05:00.000Z"),
  claudeRequest,
  codexRequest,
});
JSON.stringify({
  requests: { claude: claudeRequests, codex: codexRequests },
  first: first.map((quota) => quota.status),
  second: second.map((quota) => quota.status),
})
=> {"requests":{"claude":1,"codex":2},"first":["available","available"],"second":["available","available"]}
```

```ts cleanup
await fs.rm(stateDir, { recursive: true, force: true });
```

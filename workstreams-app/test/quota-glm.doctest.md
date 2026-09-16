# GLM (Z.ai) quota

Z.ai's coding plan reports usage over plain HTTP rather than through a CLI, so
this is the one provider whose response we parse ourselves. Two oddities, both
confirmed against a live key rather than taken from a blog post:

- The API key goes in `Authorization` with **no `Bearer` prefix**.
- `usage` is the CAP and `currentValue` is what has been spent — the opposite of
  how both words usually read. `percentage` is the used share, so that is what is
  carried and the two are never re-derived here.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseGlmQuota } from "../src/server/quota-glm.js";
import { collectAgentQuotas } from "../src/server/quota-collect.js";

/** A real response, captured from the endpoint on a fresh Lite plan. */
const FRESH = {
  code: 200, msg: "Operation successful", success: true,
  data: {
    level: "lite",
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 0, remaining: 2000, percentage: 0 },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 0, remaining: 10000, percentage: 0, nextResetTime: 1790037095999 },
    ],
  },
};
const AT = "2026-09-15T00:00:00.000Z";
```

`unit` is a period code — 3 hours, 6 weeks — with `number` as the count, so the
plan's two caps arrive as `{unit:3,number:5}` and `{unit:6,number:1}`. The plan
tier rides along in the label, since it is what decides how big the window is.

```ts
JSON.stringify(parseGlmQuota(FRESH, AT).windows.map((w) => [w.label, w.durationMinutes]))
=> [["5-hour window (lite)",300],["Weekly window (lite)",10080]]
```

## A window nobody has spent against yet

The 5-hour cap refreshes five hours after the first spend, so an unused window
reports no `nextResetTime` at all — there is genuinely no instant to name. Rather
than drop the window (reporting less than we know) it is dated as if spending
started now, which is the earliest it could end.

```ts
const [fiveHour, weekly] = parseGlmQuota(FRESH, AT).windows;
JSON.stringify([fiveHour?.resetsAt, weekly?.resetsAt])
=> ["2026-09-15T05:00:00.000Z","2026-09-22T00:31:35.999Z"]
```

The weekly window's reset is the server's own epoch-**milliseconds** value, not a
seconds value like Codex's — reading it as seconds would date it to 1970.

## Used percentages are carried, never recomputed

```ts
const spent = { data: { level: "pro", limits: [{ unit: 3, number: 5, usage: 2000, currentValue: 640, remaining: 1360, percentage: 32 }] } };
JSON.stringify(parseGlmQuota(spent, AT).windows[0])
=> {"label":"5-hour window (pro)","usedPercent":32,"resetsAt":"2026-09-15T05:00:00.000Z","durationMinutes":300}
```

## Collecting it is opt-in

Claude and Codex resolve through a local CLI or SDK, so `collectAgentQuotas`
defaults those to the real thing. GLM does not: it is an authenticated call to a
third party with the boxholder's key, and a caller that forgot to stub it would
spend real credit. Omitting `glmRequest` collects no GLM at all — the server
opts in with `glmQuotaFromEnv()`, which itself returns `null` when the machine
has no key, so a box with no coding plan shows no GLM card rather than one that
reads "unavailable" forever.

```ts
const quotas = await collectAgentQuotas({
  claudeRequest: () => Promise.resolve({ rateLimits: null }),
  codexRequest: () => Promise.resolve({ rateLimits: null }),
  stateDir: await fs.mkdtemp(path.join(os.tmpdir(), "glm-quota-")),
});
JSON.stringify(quotas.map((q) => q.provider))
=> ["claude","codex"]
```

## Nothing usable is said plainly

A response with no limits is `unavailable` with the server's own message, rather
than an empty card that looks like zero usage.

```ts
JSON.stringify(parseGlmQuota({ msg: "Operation failed", data: { limits: [] } }, AT))
=> {"provider":"glm","status":"unavailable","fetchedAt":"2026-09-15T00:00:00.000Z","windows":[],"message":"Operation failed"}
```

An unrecognized period code keeps the window — the percentage is still true —
and simply declines to name a duration.

```ts
JSON.stringify(parseGlmQuota({ data: { limits: [{ unit: 99, number: 2, percentage: 5, nextResetTime: 1790037095999 }] } }, AT).windows[0])
=> {"label":"Window","usedPercent":5,"resetsAt":"2026-09-22T00:31:35.999Z","durationMinutes":null}
```

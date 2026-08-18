# Engine availability store — episodes, latching, fail-open

The machine-level advisory store crosses two boundaries the typed
`AgentResult` cannot: `cb tick` runs scheduled scripts as subprocesses, and
quota exhaustion is account-scoped (one box's failure should inform every box
on the machine). Records self-expire at `retryAt`; a corrupt file is treated
as empty (fail-open) because an availability *hint* must never block agent
work.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  engineAvailabilityFilePath,
  liveEngineUnavailability,
  markEngineUnavailabilityNotified,
  recordEngineUnavailability,
} from "../../../src/core/agent/engine-availability-store.js";
import type { EngineUnavailability } from "../../../src/core/agent/engine-unavailability.js";

const HOUR = 60 * 60 * 1000;

function quotaAt(options: { detectedAt: Date; retryAt: Date; source?: "parsed" | "fallback" }): EngineUnavailability {
  return {
    provider: "codex",
    reason: "quota-exhausted",
    retryAt: options.retryAt.toISOString(),
    retryAtSource: options.source ?? "parsed",
    detectedAt: options.detectedAt.toISOString(),
    message: "You've hit your usage limit.",
  };
}
```

## Record → live until retryAt, gone after

```ts
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-availability-"));
t.teardown(async () => {
  delete process.env.CB_ENGINE_AVAILABILITY_FILE;
  await fs.rm(dir, { recursive: true, force: true });
});
process.env.CB_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");

const t0 = new Date(2026, 7, 18, 12, 0);
const reset = new Date(2026, 7, 19, 23, 34);
const first = await recordEngineUnavailability(quotaAt({ detectedAt: t0, retryAt: reset }));
first.shouldNotify
=> true

first.stored.episodeStartedAt === t0.toISOString()
=> true

const live = await liveEngineUnavailability({ provider: "codex", now: new Date(t0.getTime() + HOUR) });
live !== null
=> true

await liveEngineUnavailability({ provider: "codex", now: new Date(reset.getTime() + 1) })
=> null

await liveEngineUnavailability({ provider: "claude", now: t0 })
=> null
```

A run during the episode re-detects and re-records. The episode is extended —
`episodeStartedAt` survives — and after `markEngineUnavailabilityNotified` the
latch holds: no more notifications for this episode.

```ts continue
await markEngineUnavailabilityNotified({ provider: "codex", now: t0 });
const t1 = new Date(t0.getTime() + 2 * HOUR);
const second = await recordEngineUnavailability(quotaAt({ detectedAt: t1, retryAt: reset }));
second.shouldNotify
=> false

second.stored.episodeStartedAt === t0.toISOString()
=> true
```

A *parsed* reset moving materially later than what the operator was told
re-notifies (the goalposts moved); a fallback hold never does — otherwise
hourly parse-failure holds would re-notify through one long outage.

```ts continue
const laterReset = new Date(reset.getTime() + 6 * HOUR);
const moved = await recordEngineUnavailability(quotaAt({ detectedAt: t1, retryAt: laterReset }));
moved.shouldNotify
=> true

const fallbackHold = await recordEngineUnavailability(
  quotaAt({ detectedAt: t1, retryAt: new Date(laterReset.getTime() + 7 * HOUR), source: "fallback" }),
);
fallbackHold.shouldNotify
=> false
```

A detection well past the previous record's `retryAt` (plus grace) is a new
episode: fresh `episodeStartedAt`, notification due again — recurrence after
the promised reset is exactly what the operator should hear about.

```ts continue
await markEngineUnavailabilityNotified({ provider: "codex", now: t1 });
const t2 = new Date(laterReset.getTime() + 8 * HOUR);
const relapse = await recordEngineUnavailability(
  quotaAt({ detectedAt: t2, retryAt: new Date(t2.getTime() + 12 * HOUR) }),
);
relapse.shouldNotify
=> true

relapse.stored.episodeStartedAt === t2.toISOString()
=> true
```

## Corrupt store fails open

The degraded mode is the pre-store status quo — runs fail noisily — so a
broken store cannot hide anything. (The warning below is the store reporting
the corruption.)

```ts continue
await fs.writeFile(engineAvailabilityFilePath(), "{not json");
await liveEngineUnavailability({ provider: "codex", now: t2 })
=> null
```

# Engine unavailability — recognition

`recognizeEngineUnavailability` classifies an engine-level error message as
deferred-recoverable (the engine will work again later) when — and only when —
it matches a recognized provider signal. Recognition is deliberately narrow: a
misclassified permanent error would be parked as "recoverable someday" and
never fixed, so anything unmatched returns `null` and keeps the ordinary
failure path.

```ts setup
import {
  recognizeEngineUnavailability,
  describeEngineUnavailability,
} from "../../../src/core/agent/engine-unavailability.js";

// The verbatim message the Codex CLI emitted under real quota exhaustion
// (live probe, 2026-08-18) — the recognizer's anchor fixture.
const CODEX_QUOTA_MESSAGE =
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage " +
  "to purchase more credits or try again at Aug 19th, 2026 11:34 PM.";

// Box-local wall-clock times; ISO expectations are computed the same way, so
// the assertions hold in any timezone.
const NOW = new Date(2026, 7, 18, 12, 0);
```

## The Codex quota message parses, reset time included

The embedded reset time ("Aug 19th, 2026 11:34 PM") has no timezone — it is
interpreted as box-local wall clock.

```ts
const hit = recognizeEngineUnavailability({ provider: "codex", message: CODEX_QUOTA_MESSAGE, now: NOW });
hit?.reason
=> quota-exhausted

hit?.retryAtSource
=> parsed

hit?.retryAt === new Date(2026, 7, 19, 23, 34).toISOString()
=> true

hit?.detectedAt === NOW.toISOString()
=> true

hit?.message === CODEX_QUOTA_MESSAGE
=> true
```

The description is the one line every string surface shows — chat, `lastError`,
procedure output. It names the cause, the scope, and the reset time, and keeps
the provider's verbatim message.

```ts continue
const description = describeEngineUnavailability(hit!);
description.startsWith("Codex is out of usage quota until ")
=> true

description.includes("account-level: affects every box and task")
=> true

description.includes(CODEX_QUOTA_MESSAGE)
=> true
```

## Unrecognized failures stay ordinary failures

```ts
recognizeEngineUnavailability({ provider: "codex", message: "Codex Exec exited with code 1: Reading prompt from stdin...", now: new Date() })
=> null

recognizeEngineUnavailability({ provider: "codex", message: null, now: new Date() })
=> null

recognizeEngineUnavailability({ provider: "claude", message: "result.is_error was true", now: new Date() })
=> null
```

## A recognized signal with an unparseable date gets a bounded 1-hour hold

Format drift in the provider's date degrades to hourly retries — never an
unbounded park, never a hard error.

```ts
const NOW2 = new Date(2026, 7, 18, 12, 0);
const drifted = recognizeEngineUnavailability({
  provider: "codex",
  message: "You've hit your usage limit. Try again in a while.",
  now: NOW2,
});
drifted?.retryAtSource
=> fallback

drifted?.retryAt === new Date(NOW2.getTime() + 60 * 60 * 1000).toISOString()
=> true
```

## Implausible parsed dates clamp to the same hold

A reset in the past or more than 7 days out is treated as a misparse (a wrong
year or inverted AM/PM must not invert the meaning).

```ts
const NOW3 = new Date(2026, 7, 18, 12, 0);
const past = recognizeEngineUnavailability({
  provider: "codex",
  message: "You've hit your usage limit. Please try again at Aug 17th, 2026 11:34 PM.",
  now: NOW3,
});
past?.retryAtSource
=> fallback

const farOut = recognizeEngineUnavailability({
  provider: "codex",
  message: "You've hit your usage limit. Please try again at Sep 19th, 2026 11:34 PM.",
  now: NOW3,
});
farOut?.retryAtSource
=> fallback
```

## Claude signals (provisional — not yet verified against a live exhaustion)

Claude Code's known surface embeds a unix epoch: `usage limit reached|<secs>`.
The bare phrase without an epoch falls back to the hold.

```ts
const NOW4 = new Date(2026, 7, 18, 12, 0);
const epochSecs = Math.floor(new Date(2026, 7, 19, 3, 0).getTime() / 1000);
const claudeEpoch = recognizeEngineUnavailability({
  provider: "claude",
  message: `Claude AI usage limit reached|${epochSecs}`,
  now: NOW4,
});
claudeEpoch?.retryAtSource
=> parsed

claudeEpoch?.retryAt === new Date(epochSecs * 1000).toISOString()
=> true

const claudeBare = recognizeEngineUnavailability({
  provider: "claude",
  message: "Claude AI usage limit reached — upgrade to continue",
  now: NOW4,
});
claudeBare?.retryAtSource
=> fallback

describeEngineUnavailability(claudeBare!).startsWith("Claude is out of usage quota until ")
=> true
```

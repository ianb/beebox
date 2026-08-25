---
title: "A codex thread that fails to start is reported as a failed turn reading \"Cannot read properties of undefined (reading 'id')\""
workstream: honest-diagnostics
area: callback-box
priority: important
resolution: implemented
labels: [codex, chat, diagnostics]
filed-by: agent
discovered-by: Ian
discovered-in: main session — intermittent chat errors on a codex box
---

On a codex box, some chat turns fail immediately with:

```
subtype=failed num_turns=0 duration_ms=0
result="Cannot read properties of undefined (reading 'id')"
```

and a preceding line that guesses wrongly at the cause:

> Turn ended with is_error=true … Likely an unavailable model, an unresumable
> session, or a server error.

It is none of those. It is a raw `TypeError` from our own code, surfaced to the
user as a failed turn.

## Mechanism

`services/codex-chat.ts:46-74` runs an initialization chain: install the plugin,
find the box root, expand includes, `createSession(...)`, then:

```ts
if (session.id !== null) { sessionId = session.id; … }
```

`CodexSdkSession`'s getter (`services/codex-sdk-session.ts:187-188`) is:

```ts
get id(): string | null { return this.thread.id; }
```

and `this.thread` is assigned once in the constructor from
`codex.startThread(threadOptions)` (or `resumeThread`). **When that does not
return a thread, `this.thread` is `undefined` and reading `.id` throws.** The
chain's `.catch` then pushes a `result` event with `subtype: "failed"`,
`duration_ms: 0`, `num_turns: 0`, `result: errorText(error)` — exactly the shape
observed.

So a *thread that never started* is reported as a *turn that failed*, with a
TypeError as its explanation.

### Correction (2026-08-24): the mechanism above is wrong

`codex.startThread()` is synchronous and always returns a `Thread`
(`@openai/codex-sdk` `dist/index.js`, `Codex.startThread`), so `this.thread`
cannot be `undefined` and the getter cannot throw. The origin of the observed
`TypeError` is still unknown. Both catch paths in `services/codex-chat.ts` — the
initialization chain and the per-turn chain — produce the `num_turns=0
duration_ms=0` shape, so the frame alone did not say which one threw.

The reporting half of this issue is fixed: the two paths now say which phase
failed, the result frame carries a `phase` field, and `[codex-chat]` logs the
full stack at the throw site. The retry decision and the construction-rate
question moved to
[codex session start is intermittent](../../bugs/2026-08-24-codex-thread-start-failure-is-intermittent.md).

## It is intermittent, which rules out the obvious causes

Observed on one box within twelve minutes — successes and failures alternating
on the same session:

```
17:23  ok
17:28  FAILED
17:31  ok
17:35  FAILED
```

A bad model, a missing binary, or an SDK version mismatch would fail every time.
The installed `@openai/codex-sdk` was unchanged for over a week before these
appeared.

## A load signal worth investigating

The same log shows **24 `ChatSession:init` lines per minute** — one construction
every 2.5 seconds, sustained. Each one builds a `Codex` client and starts a
thread. Whether that rate is legitimate is a question on its own; it is also the
most plausible contention source for an intermittent thread-start failure.

The boxholder's own guess was that a **subagent** was involved, which fits the
same shape — more concurrent codex threads, more chances for one not to
materialize. Neither is confirmed. What is confirmed is that the code reads
`.id` off a possibly-unmaterialized thread with no guard.

## What to fix

- **Guard the read.** `session.id` must not throw when the thread did not
  materialize; a failed start is a normal, expectable outcome, not an
  impossible state.
- **Say what actually happened.** "Could not start a codex thread" is
  actionable; a TypeError about `id` is not, and the accompanying "likely an
  unavailable model…" line actively misdirects — it cost real diagnosis time
  here, pointing at a model mismatch that turned out to be irrelevant.
- **Decide whether a failed start should retry.** It is intermittent, so the
  next attempt may well work. Today the user simply sees a dead turn.
- **Then look at the construction rate**, which may be the underlying trigger
  rather than a curiosity.

## Related

- [Procedure model pins are Claude-only](2026-08-23-procedure-model-pins-are-claude-only.md)
  — filed the same day, also a codex failure that reported nothing usable. That
  one produced an empty agent thread and `exit code 1`; this one produces a
  TypeError. **Both were diagnosable only by reading Codex's thread store
  directly**, which is the pattern worth fixing beyond either bug: the codex
  path reports failures in terms of its own internals rather than what went
  wrong.

---
title: "Codex quota exhaustion surfaces as \"exited with code 1: Reading prompt from stdin…\" — we discard the real reason"
workstream: deferred-recoverable
area: beebox
labels: [codex, agent, error-messages, scheduler]
filed-by: agent
resolution: implemented
discovered-by: Ian
discovered-in: main session — persistent chat and scheduled-task failures on a Codex-engine box
---

> **Closed (2026-08-18):** implemented by the deferred-recoverable plan
> (`../../../beebox/docs/plans/deferred-recoverable-agent-failures.md`).
> Quota exhaustion is now recognized as a deferred-recoverable engine
> unavailability: the informative message (with reset time) reaches chat,
> `lastError`, and procedure output; scheduled work skips instead of burning
> attempts; `consecutiveFailures` freezes; `bbx health` shows `waiting`; the
> boxholder is notified once per episode. The loss point was refined during
> design: the semantic event was already captured in
> `src/services/codex-sdk-session.ts` — the rethrow discarded it. Verified
> live against the real exhausted account (Claude-side recognizer ships
> provisional, unverifiable until a live Claude exhaustion).

Every agent turn on a Codex-engine box fails with:

```
Chat turn failed — Codex Exec exited with code 1: Reading prompt from stdin...
```

The actual cause is that the Codex account is **out of quota**. Nothing in the
message says so, and the same string appears for scheduled tasks, so a
recoverable, time-bounded, account-level condition reads as an unexplained
engine crash.

## Confirmed empirically (2026-08-18)

Running the CLI directly reproduces it in one command:

```
$ echo "say ok" | codex exec --skip-git-repo-check
ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage
to purchase more credits or try again at Aug 19th, 2026 11:34 PM.
$ echo $?
1
```

So the condition is: **exit 1, with a precise, machine-readable message that
includes the reset time.** Everything needed for a good error is present.

## Where it gets lost

Two places, and the second is ours.

1. `@openai/codex-sdk/dist/index.js:294` throws
   `` `Codex Exec exited with ${detail}: ${stderrBuffer}` ``. In the SDK's
   JSON-event mode, stderr carries only startup chatter — "Reading prompt from
   stdin…" — while the semantic failure travels as a structured event on
   stdout. The exec-level message is therefore the least informative thing
   available.

2. **`src/core/agent/codex-run.ts:85` drops every event that isn't a completed
   item:**

   ```ts
   if (event.type !== "item.completed") return;
   ```

   The SDK exports a `ThreadError` event type alongside `ThreadEvent`. We never
   look at it. `codex-run.ts:145-149` then catches the process-level throw and
   passes `error.message` through verbatim, so the meaningless string is what
   reaches chat, `bbx health`, and the schedule state file.

## What to fix

- **Consume the SDK's error events** rather than filtering to `item.completed`.
  This is the structural fix; everything below is easier once the semantic
  error is in hand.
- **Recognise quota exhaustion as its own condition**, not a generic failure.
  It is detectable (`You've hit your usage limit`), it carries a reset
  timestamp, and it is *account*-level — every box and every task using that
  account is affected simultaneously.
- **Don't burn attempts against it.** A scheduled task currently records a
  consecutive failure and retries on its cadence; refresh-maps also retries its
  validation once, which cannot succeed either. Neither should count against a
  task whose engine was unavailable — that is how a healthy task ends up
  looking broken (observed: `consecutiveFailures: 4`).
- **Say it once, loudly, at the right level.** Quota is an operator condition,
  not a per-task defect. The useful surface is one notification naming the
  reset time, not N task failures each blaming themselves.
- **Include full stderr when there is nothing better.** Even absent the event
  work, passing the whole buffer rather than its first line would have made
  this diagnosable.

## Why this matters beyond one message

Codex became the default worker agent and an alternative box engine, so its
failure modes are now infrastructure failure modes. A quota condition that
presents as a crash sends every investigation — this one included — toward
code that changed, engines that switched, and processes that might be stale,
when the answer was an account limit with a published reset time.

Related: [Codex has no update monitor, notes, or cadence](../docs-and-chores/2026-08-08-maintenance-cadence-framework.md)
records the same theme — Codex is load-bearing and unwatched.

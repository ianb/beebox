---
title: "Codex session start fails intermittently — decide on retry, and check the ChatSession construction rate"
workstream: unattached
area: beebox
labels: [codex, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-honest-diagnostics — while making codex chat failures report their real phase and stack
next-action: verify-without-me
---

Some codex chat turns fail with no session. The failure is intermittent: on one
box, successes and failures alternated over twelve minutes on the same session.
A wrong model, a missing binary, or an SDK version mismatch would fail every
time.

Two parts of that report are still open. Both were deliberately left out of the
diagnostics work in
[the reporting bug](../closed/bugs/2026-08-23-codex-thread-init-failure-reads-as-a-turn-error.md),
which changed only what the failure says, not what happens after it.

## Should a failed start retry?

`services/codex-chat.ts` runs one initialization chain per run. If a step of
that chain rejects, the run emits a `session-start` result frame and every
later `send()` is a no-op — the user sees a dead turn and must send again.

An intermittent failure is the case where a retry works. It is not obviously
correct here:

- The chain has steps with side effects (`ensureCodexPluginInstalled` shells out
  to `codex plugin`), so a retry is not a pure re-attempt.
- A retry hides the failure rate. The diagnostics landed for the reporting bug
  are what makes the rate visible; retrying before anyone has read them removes
  the signal that says how often this happens.
- A retry that also fails doubles the user's wait before the dead turn appears.

Decide the policy first: retry count, what is retried (the whole chain or the
session creation only), and what the user sees while it retries.

## Is the construction rate legitimate?

The same log showed 24 `ChatSession:init` lines per minute — one construction
every 2.5 seconds, sustained. Each construction builds a `Codex` client and
starts a thread. Two questions, in order:

1. What produces that rate? A subagent, a reconnect loop, and a polling client
   all fit the shape. Nobody has traced it.
2. Is concurrency at that rate the trigger for the intermittent start failure?
   It is the most plausible contention source, and it is unconfirmed.

The second question is worth answering before the retry decision: if the rate is
a bug, fixing it may remove the failure that the retry would paper over.

## What is already in place

The reporting bug's fix makes this investigable without reading Codex's thread
store:

- A failed run says which phase threw — `Could not start codex session: …` for
  the initialization chain, `Codex turn threw before completing: …` for the
  turn — and carries a `phase` field on the result frame.
- `[codex-chat]` logs the full stack of whatever threw, at the throw site.
- The chat-session warning logs the phase and the result text and names no
  cause. It previously guessed "Likely an unavailable model, an unresumable
  session, or a server error", which was wrong here.

So the next occurrence should carry a stack that names the throw site. The
mechanism in the original issue — a `.id` read on an unmaterialized thread — was
checked and does not hold: `codex.startThread()` is synchronous and always
returns a `Thread`. The real source of the observed `TypeError` is still unknown.

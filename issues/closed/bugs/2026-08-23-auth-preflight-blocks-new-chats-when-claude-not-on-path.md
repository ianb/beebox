---
title: "New chats intermittently fail with \"Claude Code is not logged in\" while existing chats keep working"
workstream: small-bugs-batch
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — a journey walkthrough could not start a second chat
priority: normal
resolution: implemented
---

Closed 2026-08-29 by this commit (`docs(issues): close inconclusive auth preflight bug`): spawn, timeout, empty, and unparseable probes now return `AUTH_PROBE_INCONCLUSIVE`; after one retry the preflight lets the real SDK judge auth.

> **Reconfirmed 2026-08-24 — still live, unchanged.** Tag removed. The defect
> this issue names is verbatim still in the code: `services/claude-cli.ts:27`
> is still `execFile("claude", ["auth", "status"], …)`, resolving from `PATH`,
> and any spawn failure still lands in the `err` branch as
> `{ loggedIn: false }`. Nothing has touched it. The trigger remains
> unreproduced, but the fix identified here does not depend on reproducing it:
> the preflight probes a binary the SDK does not use.

Twice in one session, every attempt to start a **new** chat failed instantly with

```
Claude Code is not logged in — run `claude auth login` on this machine
```

while the chat already open kept answering normally throughout. `claude auth status`
on the machine reported `{"loggedIn": true}` the whole time, so following the
instruction would have changed nothing.

**It does not reproduce.** A later walk on a fresh box started new chats without
trouble, and two direct probes — a new chat each time — were answered normally. So
this is intermittent and the trigger is not known.

## What is established

`checkClaudeAuth` (`src/core/agent/auth-preflight.ts`) runs before an interactive
session's **first** SDK run. That alone explains the shape of the symptom: an
existing chat is past the check, a new one is not. A confirmed login is cached for a
generous TTL; a negative is never cached, so a failing probe blocks every new session
until it starts succeeding again.

The probe is `execFile("claude", ["auth", "status"], …)` (`src/services/claude-cli.ts:27`),
resolving `claude` from `PATH`. Any failure to run it at all — missing binary, timeout,
a transient error — lands in the `err` branch and returns `{ loggedIn: false }`. A
process that could not be spawned is reported as a login that does not exist.

## The part worth fixing regardless of the trigger

The agent does not use that binary. `src/core/sdk-binary-path.ts` says so plainly:

> The system installer at `~/.local/bin/claude` is *not* what the SDK uses — by
> Anthropic's design it ignores `$PATH` and looks only at its sub-packages.

So the preflight probes a **different** Claude Code than the one that would serve the
chat, and refuses on its absence or its failure. In the observed sessions the agent was
demonstrably healthy: the older chat answered every message while new ones were refused.

That makes any failure of this probe a false negative for the thing it guards. Its own
doc comment says it exists so a missing login is not "an opaque `success: false` from
the Agent SDK stream" — a good intent that this inverts, turning a working agent into a
confident wrong diagnosis and unactionable advice.

## What would settle it

- Log the underlying error when `authStatus` takes the `err` branch. Right now a
  spawn failure, a timeout and a real logout are indistinguishable downstream, which
  is why this could not be diagnosed from the outside.
- Distinguish "could not run the check" from "checked, and not logged in" — only the
  second should say "not logged in", and only the second should advise logging in.
- Consider probing what the SDK actually resolves (`sdk-binary-path.ts`), or not
  blocking on this at all.

An earlier version of this issue asserted a `PATH` cause from a process inspection
that, on re-checking, had probably read the wrong process. Recorded here so nobody
builds on it: the mechanism above is what the code shows, and the trigger is open.


> Recovered 2026-09-21 from the August 25 journey A report. This is historical
> evidence, not a fresh re-encounter; current status and priority are unchanged.

## A first-time user's view of this failure (journey A, 2026-08-25)

A simulated first-time user hit this wall as the very first thing the product
ever did for them: two questions, two pink bars, zero answers. Their third try
worked — retrying was the whole fix — and nothing on screen suggested trying
again.

Their reading of the message, verbatim, is the sharpest account we have of what
this string does to a user:

> "I have no idea what 'Claude Code' is. My friend said 'an AI app'. Nobody
> said Claude Code."
> "run `claude auth login` — run it *where*? There's no place in this app to
> run anything. This is a sentence written for whoever built it, shown to
> whoever uses it."
> "Nothing tells me whether my two messages were *lost* or are queued."

And what they asked for is a fair spec for the interim fix, independent of the
root cause: *"This box can't reach its AI right now — nothing you typed was
lost. Whoever set it up needs to sign it in."* Plus a retry button — and, given
retry-fixed-it here, arguably an automatic one.

They ranked this #1 of everything that nearly ended the evening: "If I hadn't
been told to push through I'd have closed the tab and texted my friend."

Unresolved by the retry: their two failed messages stayed visible in that
session with nothing under them, and after starting a new chat they could not
find them again — "Whether my first two messages still exist anywhere" made
their closing list of open questions.

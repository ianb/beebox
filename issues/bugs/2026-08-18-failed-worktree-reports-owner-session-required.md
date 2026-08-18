---
title: "A failed worktree surfaces to clients as `owner-session-required`, which sends debugging the wrong way"
workstream: unattached
area: router
labels: [router, auth, error-messages]
filed-by: agent
discovered-by: Ian
discovered-in: main session — iOS reported an auth error for what was a crashed worktree
---

When a worktree is in state `failed`, a client asking for a box inside it gets

```json
{"error": "owner-session-required"}
```

That names an authentication problem. The actual problem was that the
worktree's hub had crashed on startup 45 minutes earlier
([Vite port-walk steals the hub port](2026-08-18-vite-port-walk-steals-the-hub-port.md)).

Observed from iOS, 2026-08-18: the app first complained the box would not
start, then showed the auth error. The boxholder's reasonable reading was that
a credential or session had expired — *"something timed out or changed?"* — and
the honest answer was "a process died." Nothing about the response pointed
there.

## Why it says that

The router's own control surfaces (`/`, `/__router/*`, `/<w>/dev/*`) are
`control` / `control-read` routes gated on an owner session
(`bin/router-auth.ts`). A device holding perfectly good per-box mobile
credentials is not an owner session, so it gets 401 with that reason. The
mechanism is correct for a control route. The problem is that a client asking
for a **box** ends up on that surface at all when the worktree behind it is
down, so a liveness failure is reported in the vocabulary of authorization.

## What good would look like

- **A dead worktree should say so.** `failed` is a state the router already
  tracks and already renders for browsers (there is a fallback page for the
  workstreams app). An API client deserves the same fact: the worktree is down,
  here is where its log is, here is how to retry.
- **Distinguish "you may not" from "it isn't there."** 401 with
  `owner-session-required` is a claim about the caller. A crashed dependency is
  a claim about the server — 503 with a reason is the honest shape.
- **Don't leak more than the caller may know.** The reason string can name the
  worktree state without exposing router internals to a client that failed
  authorization for a genuinely gated route. The two cases need separating
  before the message can be improved safely.

## Cost of leaving it

This is a debugging-time bug, and it is expensive out of proportion to its
size: it points the reader at auth, sessions, and recent deploys — all plausible
and all wrong — while the real evidence sits in a worktree log the client has no
reason to look at. It cost about half an hour on 2026-08-18, and it will cost
that again every time a worktree dies, because the message is *convincingly*
about the wrong thing.

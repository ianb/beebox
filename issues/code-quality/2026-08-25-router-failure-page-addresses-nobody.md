---
title: "The router's failed-to-start page speaks only engine — Retry gives no feedback, the one exit is a login wall"
workstream: unattached
area: router
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey A's walk landed on it for a whole run
priority: backlog
---

## Recovery assessment (2026-09-21)

Partly improved since the walk. The
[router retry fix](../closed/bugs/2026-09-15-dev-router-transient-failures-are-permanent-and-unlogged.md)
added bounded automatic retry and status prose. `router-failed-page.ts:22-42`
now explains retry state. Lines 82-101 still lead with worktree/phase/engine
errors, use a bare POST Retry button without in-page progress handling, and
link to router root. Narrow the old blanket claim of no feedback to manual
button feedback and guest-facing explanation. Do not reopen the closed retry
issue on the basis of this older observation.


> Recovered 2026-09-21 from `worktree-user-stories-refresh` at `f914fcb4e`.
> The account below describes the 2026-08-25 walk, not a new reproduction.
> Source line numbers in that account are historical. Current disposition is recorded below.


When the app behind a link is down, I want the page to tell me in one sentence
whether it is my problem and what to do, so I can stop or escalate instead of
poking at machinery.

A journey walker — playing a first-time user whose friend sent them a link —
spent an entire run on `bin/router.ts`'s "Worktree failed to start" page,
because a harness bug (since fixed) kept the worktree down. The walk produced
no app findings, but it is the only extended user-eye view of this page we
have, and the page did badly:

- **It hands the user the engine.** vite output, fastify output, `waitForHttp`,
  a zod record error. Verbatim: *"That is not an app, that's the guts of
  something. I don't know what vite or fastify are and I don't want to."* And:
  *"the thing that's broken has my name in it"* — the failing config key was
  their own box slug, with nothing actionable attached.
- **"Retry startup" gives no feedback at all.** Four presses: no spinner, no
  attempt counter, no new message. *"A button that visibly does nothing is
  worse than no button, because I kept coming back to it."*
- **The only other exit is a login wall.** "← back to router index" lands on
  `/main/auth/login` for a visitor with no account. Two exits: a button that
  does nothing, and a door they cannot pass.
- **What they asked for is one sentence:** *"This app isn't running right now —
  tell the person who set it up."*

This is a dev surface, and its primary audience is the developer — the raw logs
should stay. But worktree links get handed to walkers, phones, and guests, and
the page cannot tell which reader it has. A human-language sentence above the
logs, and a Retry that visibly does something (even "retrying… attempt 3"),
would serve both readers without hiding anything.

Secondary observation from the same sitting: reloads of the error page itself
degraded from instant to 60s+ over the run, and `bin/browse screenshot` began
hanging past 180s — consistent with the daemon-wedge family already parked in
`watch/`.

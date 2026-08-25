---
title: "A single 401 from any procedure throws the whole app to a login form, mid-work"
workstream: unattached
area: callback-box
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
---

When I am part-way through something in the box, I want a permission problem
with one action to stay that one action's problem, so that I do not lose the
work in front of me.

`trpcFetch` (`src/frontend/src/lib/trpc/index.ts:24`) treats a 401 on **any**
tRPC call as "this session is over": for a non-mobile client it sets
`window.location.href` to `/auth/login?returnTo=…` and returns a promise that
never resolves. There is no distinction between *your session expired* and
*this one procedure is not available to you*, and no explanation on the way out.

A walker hit this by clicking a record row after an evening of cataloguing:

> *"the whole app replaced itself with a **Sign in** page — Email, Password,
> Sign in. I have never signed in to this thing; my friend gave me a link and it
> just worked. My first thought was 'have I lost everything I just spent the
> evening on?'"*

Going back put them straight back in with everything intact, so nothing was
lost — but they had no way to know that at the time, and they wrote afterwards
that if it had happened in a shop, *"that's the end of me using this."*

**Their 401 was the harness**, and that part is not a product finding: the walk
drove the app with a browse key, which is not the box owner, so an owner-gated
procedure answered 401 correctly. The mechanism it exposed is not
harness-specific. Any genuine session expiry takes the same path, and so does
any call a signed-in-but-unauthorised user makes.

What is worth deciding:

- **A hard navigation discards whatever is on screen.** `returnTo` restores the
  route, not the state. Whether a composer draft survives depends on the
  persistence layer, and the user has no way to find out before they click.
- **401 is doing two jobs.** "Not authenticated" and "not permitted" are
  different answers, and only the first justifies a login form. The capture
  route already distinguishes them (`capture.ts` returns 401 for
  `unauthenticated` and 403 elsewhere) — the client collapses that back.
- **The eject is silent.** Landing on a login form with no sentence explaining
  why reads as data loss, which is what the walker assumed.

Related: [reloaded-conversation-hides-the-photos-you-sent](2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md).

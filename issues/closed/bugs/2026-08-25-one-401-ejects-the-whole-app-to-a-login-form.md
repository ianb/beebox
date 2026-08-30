---
title: "A single 401 from any procedure throws the whole app to a login form, mid-work"
workstream: live-vs-stored
area: beebox
labels: [journey-findings]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — journey B, 2026-08-24 walk
resolution: implemented
---

Closed 2026-08-25 by commit `36312a3a` (workstream `live-vs-stored`) — a 401
now raises a persistent, explained toast with a Sign in link instead of a hard
navigation, and `trpcFetch` returns the failure instead of a promise that
never resolves. Verified in the running app via a forced 401.

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

## Where the 401s actually come from (traced 2026-08-25)

The original filing said an owner-gated procedure answered 401. It cannot have,
and the correction narrows this issue considerably.

- `ownerProcedure` throws **FORBIDDEN**, not UNAUTHORIZED
  (`src/webapp/trpc/trpc.ts:34-40`).
- More decisively, **a tRPC procedure error never sets the HTTP status here.**
  Every HTTP link in the frontend is `httpBatchStreamLink`
  (`src/frontend/src/lib/trpc/index.ts:125-127`), so the server takes the jsonl
  streaming branch, which builds its response with `untransformedJSON: null`
  and therefore `status = 200` unconditionally
  (`@trpc/server` `resolveResponse`, `initResponse`). The per-call error rides
  inside the streamed body. A batch where every procedure throws UNAUTHORIZED
  is still HTTP 200.

So `trpcFetch`'s `response.status === 401` can only fire on a **transport-level**
401 — the box auth wall preHandler (`src/webapp/server-box-scope.ts:126-140`),
which already draws the distinction the filing asked for: **401** only when
there is no identity at all on an API URL, **403** for authenticated-but-not-
permitted, **503** for an unreadable auth store, and a 302 login redirect for
HTML navigation rather than an API call.

In ordinary use that leaves one real cause: **the `bbx_session` cookie is gone** —
30-day expiry, or `gen`-revoked by a password change (`src/webapp/auth.ts:26`).
Mobile has its own 1-hour `bbx_mobile` lapse, already handled by refresh-and-retry
before any eject.

## What this means for the fix

The eject's *trigger* is correct; there is no permission-vs-expiry confusion to
untangle, because the permission case never reaches the client as a 401. What is
wrong is everything after the trigger:

- **A hard navigation discards whatever is on screen.** `returnTo` restores the
  route, not the state. Whether a composer draft survives depends on the
  persistence layer, and the user has no way to find out before they click.
- **The eject is silent, and never resolves.** `trpcFetch` returns
  `new Promise(() => {})` (`index.ts:41`), so the calling code hangs forever
  while the page is replaced. Landing on a login form with no sentence
  explaining why reads as data loss, which is what the walker assumed.
- **It is also inconsistent.** Raw REST calls (`/api/chat/send`, capture,
  uploads) take the same wall 401 and do not eject at all — they just fail.

The 401 the walker hit was the harness (a browse key is not the box owner), but
the path is the same one a real 30-day expiry takes.

Related: [reloaded-conversation-hides-the-photos-you-sent](2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md).

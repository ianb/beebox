---
title: "A 502 during a deploy restart reaches the UI as \"Unexpected token '<', \\\"<!DOCTYPE\\\"... is not valid JSON\""
workstream: unattached
area: beebox
priority: normal
labels: [deploy, frontend, error-reporting]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the Google Services admin panel showed the parse error after clicking Re-authorize
---

Clicking **Re-authorize** in Google Services on a box produced
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON` in the panel's error
box. Nothing was wrong with the OAuth flow: nginx returned its own HTML 502
page because the hub was mid-restart, and the tRPC client tried to parse it.

The nginx log is unambiguous — two `POST /<box>/api/trpc/admin.googleSetup?batch=1`
at 14:14:11 and 14:14:13 UTC, both `502 568`, referrer `/<box>/admin`, while
the hub was between its SIGTERM (14:13:12) and its restart (14:14:12). Batched
queries in the same window 502'd too. Calling `admin.googleSetup` afterwards
returns a valid `authUrl`, so nothing is broken now.

`trpcFetch` in `beebox/src/frontend/src/lib/trpc/index.ts` has a case for 401
(`reportSessionEnded`, from the one-401-ejects-the-app work) but nothing for a
non-JSON body or a 5xx. Every surface with an error box shows the parse error
raw, which reads like a client bug and tells the boxholder nothing actionable.

## What to change

- **Detect a non-JSON response in `trpcFetch`** — a `content-type` that isn't
  JSON, or a 502/503/504 — and turn it into one honest message: the server is
  restarting or unreachable, try again in a moment.
- **Turn query retries back on.** See the section below — this is the primary
  fix, not a consideration.
- **Related**: [stale web bundle detection](../features/2026-08-12-stale-web-bundle-detection.md)
  — the other half of "the deploy moved under the open page."


## The real cause: retries are off globally (2026-09-10)

Recurred today. Opening the app bar's place-switch menu on a box rendered
"Couldn't load this menu — Retry"; the nginx log shows four
`GET .../api/trpc/chat.placeMenu…` at 16:26:38-16:26:45, all `502 568`, inside
a hub restart (SIGTERM 16:26:05, back at 16:27:06). Those are the only
non-200 `placeMenu` requests in the whole log. Two user-visible failures in two
days, both landing in a restart window.

Boxholder: "Shouldn't 502s just be retried in a bit? That's what 502 means,
right?"

They should, and they aren't, because
`beebox/src/frontend/src/lib/trpc/provider.tsx:11` disables retries for every
query in the app:

```ts
queries: { staleTime: 5000, retry: false },
```

React Query's default is 3 attempts with exponential backoff, which would ride
over a ~60s restart with nothing visible to the person using the app. With
`retry: false`, any transient blip renders as a permanent error. That is the
bug; the raw parse-error text is how it looks, not why it happens.

**What the fix has to get right**

- **Queries retry, mutations do not.** A tRPC query is a GET and idempotent by
  contract. A mutation is not: a 502 usually means the request never reached
  the app, but "usually" is not a basis for replaying
  `admin.googleSetup` or a send. Mutations keep a manual retry affordance —
  which the place menu already has and the Google panel does not.
- **Only the transient classes.** 502/503/504 and network failures; never a
  4xx. `retry: false` may well have been chosen to stop 401s from spinning, and
  401 already has its own handling in `trpcFetch` (`reportSessionEnded`, plus
  the mobile-token refresh-and-retry-once). Re-enabling retries blindly would
  regress that.
- **Bounded, with backoff.** A deploy window is ~60s (see
  [hub shutdown](2026-09-09-hub-shutdown-hits-the-sigterm-timeout.md)), so a
  few attempts over that span is the target, not indefinite spinning.
- **The honest message becomes the fallback** for when retries are exhausted,
  rather than the first thing the boxholder sees.

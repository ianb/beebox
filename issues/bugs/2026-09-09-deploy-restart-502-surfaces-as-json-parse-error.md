---
title: "A 502 during a deploy restart reaches the UI as \"Unexpected token '<', \\\"<!DOCTYPE\\\"... is not valid JSON\""
workstream: trpc-retry-transients
area: beebox
priority: normal
labels: [deploy, frontend, error-reporting]
needs: [manual-testing]
filed-by: agent
discovered-by: Ian
discovered-in: main session — the Google Services admin panel showed the parse error after clicking Re-authorize
---

> **⏳ Awaiting manual testing** — fix landed in `b49c2cae7`; during a deploy
> restart, open the place-switch menu and expect it to load after a pause, not
> fail. Only the developer clears this.

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

## Fix (2026-09-10)

`b49c2cae7`. The transport classifies once, by HTTP status.
`fetchFromBox` (`beebox/src/frontend/src/lib/trpc/transient.ts`) is used by
`trpcFetch` and by the file view's raw-text loader. It turns a 502/503/504, or
a request that got no response, into a `BoxUnreachableError`. The error message
is the sentence to show: "The box did not answer — it may be restarting. Try
again in a moment." Status is used, not content-type, because the hub's own 502
(box child down) has a JSON body. A batch streams its results after a 200, so
the connection can also break partway through the body when a deploy kills the
hub. `fetchFromBox` wraps the body so that a failed read is also a
`BoxUnreachableError`. The members that were already delivered keep their
results. Only the unfinished members fail and are retried.

A `retryLink` on the HTTP branch of `buildTrpcLink` retries **queries** that
failed that way. The schedule is 1, 2, 4, 8, 16, 30, 30 s (about 91 s). The
link reaches every caller: the 69 `useQuery` hooks and the 20 vanilla
`trpcClient.x.query()` sites, including XState actors and the Google panel's
status fetch. The QueryClient keeps `retry: false` so that two schedules do not
multiply. Mutations are never retried; they fail at once with the same message.
A 401 is never retried, and its handling in `trpcFetch` is unchanged.

The message-matching predicate in `file-load-state.ts` is removed. It also
retried procedure-level 500s, which are bugs, not outages.

Known limit: during the retries a query stays pending. A menu shows "Loading…"
for up to about 90 s, with no "restarting" indicator.

Tests: `beebox/test/frontend/lib/trpc-transient.doctest.md` runs the real
`httpBatchStreamLink` + `retryLink` against a tRPC server behind a stand-in
nginx 502. With plain `fetch` in place of `fetchFromBox`, it reproduces the
reported `Unexpected token '<', "<!DOCTYPE "...` message and fails.

## Manual testing

Needs a real deploy restart (merge to `main`), because only prod has nginx in
front of the hub.

1. Open a box in the browser. Merge something that deploys, or restart the hub.
2. Within the ~60 s window, open the app bar's place-switch menu. Expected: it
   shows "Loading…" and then the menu, not "Couldn't load this menu".
3. In the same window, click **Re-authorize** in Admin → Google Services.
   Expected: the error box says "The box did not answer — it may be
   restarting. Try again in a moment." and no JSON parse error. Clicking
   again after the restart works.

---
title: "Loading the admin page intermittently hangs the browser tab; a reload clears it"
workstream: admin-hang-probe
area: beebox
labels: [ui, admin]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder reporting it right after it happened
priority: normal
---

Opening the admin page froze the tab the way a synchronous infinite loop does:
the page stopped responding rather than showing a spinner or an error.
Reloading the same URL worked. The boxholder has seen this before, possibly on
the same page, possibly on settings.

Not reproduced yet, and no capture exists from an occurrence.

## What is not known

- Which deployment: the production server or a local box through the dev
  router.
- Which box, and whether the box was cold (a hub cold-start makes the first
  request slow, which is a different failure than a hang).
- Whether the tab was pinned to an older build than the server (a stale SPA
  against new API shapes is a plausible source of a render loop).

## Why it is hard to find by reading

A frozen tab means the main thread never yields: a render loop (an effect that
sets state on every render), a `while` loop over data that never terminates, or
a synchronous layout loop. A stuck network request cannot do it. The admin page
is 50 lines (`beebox/src/frontend/src/pages/AdminPage.tsx`) that compose ~20
sections under `components/admin/`, so the loop is likely in a section, not the
page. The nine `useEffect` calls across those sections all read as
mount-only, so a naive scan does not find it — which fits an intermittent
trigger (a specific response shape, a slow first request, a race between two
queries).

## What to capture next time it happens

Before reloading:

1. Chrome DevTools → Performance → record a few seconds. A render loop shows
   as one script frame repeating; the call stack names the component.
2. The Console tab, for React's "Maximum update depth exceeded" — that error
   names the culprit directly.
3. The Network tab: which requests had completed when the tab locked up.

If it proves unreproducible on demand, use the `field-probe` approach: ship
bounded instrumentation (a render-count guard that logs the offending
component instead of looping forever) and wait for it to fire.

## Related

`issues/closed/bugs/2026-08-21-secrets-section-shows-the-same-error-twice.md`
is the last bug in this area; the Secrets section is the largest part of the
page and the one with the most conditional state.

## Discussion (2026-09-24)

The boxholder sees this on iOS, so there is no DevTools, Performance recording,
or Network tab to capture from. Disposition: ship bounded instrumentation
(the field-probe approach) and wait for it to fire. A frozen main thread cannot
send its own report, so the probe must either catch the loop before it locks
up, or report from somewhere the main thread does not own (a Web Worker
watchdog, or a breadcrumb that the next page load sends).


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

## After the next iOS freeze

The temporary field probe is committed as `225de6982` in `admin-hang-probe`;
it is **not deployed yet**. Once it lands, the boxholder should load a fresh
bundle, reproduce the freeze as usual, reopen the **same box** after the freeze,
and tell the investigating agent. The agent should then read that box's log.
From the monorepo root, replacing `BOX_NAME` with the affected box's server
directory name:

```bash
beebox/deploy/prod-ssh "grep -F '[admin-hang-probe]' /home/beebox/boxes/BOX_NAME/.beebox/client-debug.log | tail -20"
```

For a reproduction in this worktree's isolated local `test1` box instead:

```bash
rg -n -F '[admin-hang-probe]' ~/src/box-worktrees/admin-hang-probe/test1/.beebox/client-debug.log
```

The report says `possible freeze`, identifies `page=admin|settings`, gives the
age of the last heartbeat as `staleMs`, and lists up to eight recent
`enter:<section>` and `query:<procedure>` breadcrumbs with milliseconds since
the probe started. `entries` counts section-wrapper entries; `mounted=0`
means the page did not finish mounting before it stopped. The log timestamp is
when the report arrived after reopening, not necessarily when the freeze began.
The last `enter` is a lead for investigation, not proof that section caused
the loop. Compare nearby client errors, especially React's “Maximum update
depth exceeded,” and the completed query names. No report does not rule out
the bug: the probe depends on browser storage and a later load of the same box.

The probe lives in `beebox/src/frontend/src/lib/admin-hang-probe.ts` and
`beebox/src/frontend/src/components/admin/AdminHangProbe.tsx`, with call sites
in `app-shell.tsx`, `AdminPage.tsx`, and `SettingsPage.tsx`. Remove these after
the field evidence identifies the cause. If it happens in a desktop browser,
capture DevTools Performance, Console, and Network evidence before reloading.

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

---
title: "The loading page's \"couldn't load\" hint appears after 5 seconds, during an ordinary box warm-up"
workstream: boot-hint
area: beebox
labels: [ui-error]
filed-by: agent
discovered-by: Ian
discovered-in: main-checkout conversation, 2026-10-20
priority: normal
resolution: implemented
---

Fixed in worktree-boot-hint (2026-10-22): the loading page says "Starting
your box…", and the "couldn't load" hint appears after 30 s instead of 5 s.
The card animation runs 17 cycles (ends at 28.6 s), so it stops before the
hint appears. Measurements and verification are below.


The boxholder often sees the loading page's warning, "If this message stays,
the app couldn't load. Try reloading, or sign in again." They have had no
loading failures. The box sometimes takes longer than usual to warm up, and the
warning appears while it does. A warning that shows during normal loads teaches
the reader to ignore it.

## Where it comes from

`beebox/src/frontend/index.html` shows a boot fallback inside `#root` until
React mounts. The hint is CSS only (`script-src` forbids inline script) and
fades in on a fixed delay: `animation: app-boot-hint-in 0s linear 5s forwards`.
The page waits for the entry script and for `/api/boxes`; the shell renders
nothing until the box list arrives. A box that is starting (the hub starts one
`bbx serve` child per box on demand) can take more than 5 seconds before that
list answers, with nothing wrong.

## Directions

- Raise the delay so it exceeds a normal cold start. Measure cold-start time to
  `/api/boxes` first, on the dev router and in production, and set the delay
  above the slow end of it.
- Make the first message say the box is starting ("Starting your box…"), and
  show the failure wording only much later.
- Let the server say when a box is starting. The hub knows when a box child is
  not yet up; a starting state could replace the fixed timer. This needs a
  script or a server-rendered response, since the hint is CSS only.

Related: [box first load is slow](../../bugs/2026-10-07-box-first-load-is-slow.md).

## Measurements (2026-10-22)

The hint's timer starts when the page HTML renders. In production, and on the
dev router, the HTML waits until the box server is up: the hub starts a stopped
box before it answers, and `sw.js` has no fetch handler, so no cached page
renders first. The time that counts is therefore from HTML arrival to React
mount.

Local production-shaped hub (`pnpm perf:hub`, built bundle, edge stand-in,
box stopped before each run, fresh browser context). The machine was busy
(load average 7–16), so box starts took 1.0–3.0 s, against 0.64 s on
2026-10-07. "Shell" is the `bbx:shell` mark, measured from navigation.

| Case | Runs | HTML TTFB (median) | Shell, median (max) | Shell after HTML (median) |
| --- | --- | --- | --- | --- |
| No throttling | 5 | 1.7 s | 1.9 s (2.3 s) | 0.2 s |
| 4G, 4× CPU | 5 | 1.8 s | 2.9 s (3.2 s) | 1.1 s |
| 4G, 4× CPU (earlier pass) | 3 | 1.6 s | 2.7 s (4.8 s) | 1.1 s |
| Slow 4G, 4× CPU | 5 | 1.6 s | 5.0 s (5.5 s) | 3.3 s |

Dev router, this worktree, fresh browser context, no throttling:

| Case | HTML arrives | Shell | Shell after HTML |
| --- | --- | --- | --- |
| Worktree cold (Vite and backend stopped) | 13.5 s | 27.2 s | 13.7 s |
| Worktree cold, after the change | 5.6 s | 12.5 s | about 7 s |
| Worktree warm | at once | 2.6–2.8 s | 2.6–2.8 s |

On a cold dev worktree, Vite transforms the module graph on the first page
request, and this took about 14 s. With the 5 s timer, the hint was visible from
18.7 s to 27.2 s during that load. This is the slowest normal case measured, and
it is the likely source of the reports. On slow 4G in the production shape, the
mount comes 3.3 s after the HTML, which is near the old 5 s limit. A slower
phone or network goes past it.

Chosen delay: 30 s, about twice the slowest normal case measured.

## Verification (2026-10-22)

Headless Chrome on the dev router, worktree stopped first:

- Cold start: "Starting your box…" was visible, and the hint's opacity stayed 0
  until React replaced the fallback at 12.5 s.
- Entry script blocked (`Network.setBlockedURLs` on `src/main/app.tsx`): the
  page showed "Starting your box…" with moving cards at 8 s. The hint reached
  opacity 1 at 30.3 s, and at 32 s the cards had stopped.

## Server-reported "starting" state: not pursued

The hub sends no HTML until the box child is listening, so the page never
renders while a box is starting. A server-reported "starting" state would first
need the hub to answer before the child is up, for example with a holding page
that polls. In production, the time after the HTML arrives goes to the entry
script, `/api/boxes`, and render, not to the box start, so a "starting" signal
would not cover the slow part. The fixed 30 s timer covers the measured cases.

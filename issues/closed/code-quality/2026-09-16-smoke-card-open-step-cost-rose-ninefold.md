---
title: "The smoke walk's card-open step rose from about 5s to about 45s and now fills most of the 120s budget"
workstream: refresh-maps-correctness
area: monorepo
labels: [tests]
filed-by: agent
discovered-by: agent
discovered-in: worktree-smoke-review — the weekly smoke-tier review, 2026-09-16
resolution: implemented
---

Closed 2026-09-19 in `ca2f52c48`: fixed per the "Cause and fix" section
below — the walk regressed, not the app. Scoped snapshots (`browse/src/act.ts`)
now drop out-of-scope ids inside the `eval` instead of probing each one with a
separate `get attr` call, and `bin/smoke`'s card-open step takes its
failure-evidence full snapshot only on failure. card-open went from ~61s to
~31s on this worktree's box. The residual ~6.5s-per-checked-click cost (dating
to 2026-08-23) is documented and deliberately left alone.

The `card-open` step of `bin/smoke` is the only step whose cost changed
materially. The step still earns its place, so do not remove it. The problem is
its duration: green walks now come close to the two-minute budget, and walks
that run out of budget fail as red.

## Evidence

Source: `$(git rev-parse --git-common-dir)/beebox-smoke-log.jsonl`. Values are
the durations of `card-open` steps with outcome `ok`:

```
day         runs  card-open p50  max    green walk p50  max
2026-09-04     8        5.0s     5.1s       34.0s      35.2s
2026-09-05    20        9.4s     9.8s       36.3s      50.9s
2026-09-08     5       12.9s    16.1s       46.7s      50.8s
2026-09-09     3       37.0s    48.8s       92.5s     101.0s
2026-09-12    31       43.6s    58.6s       73.9s      98.9s
2026-09-14    11       47.7s    61.4s       87.8s     102.2s
2026-09-16    14       45.6s    62.0s       78.8s     106.2s
```

Green walks from 2026-09-09T19 to 2026-09-16 (97 walks), per step, p50 / max:
restart 1.0/6.5, cold-start 8.8/23.7, chat-shell 6.1/17.6, place-menu 3.3/8.7,
place-switch 5.8/11.5, browse-list 3.7/9.8, **card-open 44.4/62.0**,
page-errors 0.6/1.3. 15 of the 97 green walks took more than 90s.

In the same window, 5 of the 22 red walks ran out of budget and did not fail an
assertion. They were card-open (3), chat-shell (1), and place-switch (1). A
red walk also blocks a landing. The most recent walk in the log
(2026-09-16T19:37, `worktree-full-embrace-annex`) ran out of budget in
card-open after 40s, and the earlier steps had already used 80s.

## Where the change started

The first walks slower than 30s ran on `worktree-paper-cards` on 2026-09-09
(commits `37fcf5200` 37.0s and `fbd9e1ddb` 48.8s). The step took 12.9s on
`chat-everywhere` just before that. That branch added themed card workspaces
(`98bc0aacb feat(chat): add themed card workspaces`). The increase from 5s to
9s on 2026-09-05 matches `a67f479a5`, which added the one-root drill-down and
the folded-row reveal to `bin/smoke-card-open.ts`.

## Unknown: slow app or slow walk

The log records only a total for each step, so it cannot show which part of
card-open takes the time. There are two possible causes:

- **The app regressed.** Opening a card in the browser now takes tens of
  seconds. This is a user-visible bug that reached `main`, and the walk showed
  it only as a longer duration.
- **The walk regressed.** One of the `waitForReady()` calls in `findCardRow`
  or in the step body waits for a signal that the themed workspace no longer
  sends (for example a network-idle state that never occurs) and then continues
  after its timeout.

## Next action

Open a card by hand on a dev box and time it. Then time each sub-step of
card-open (listing snapshot, folded-row reveal, drill into `_content`, card
click, render check). If the app is slow, file a bug. If the walk is slow, fix
the wait. Also consider adding sub-step timing to the log, so that a later
review can locate this kind of increase without running the walk again.

## Cause and fix (2026-09-19, workstream refresh-maps-correctness)

The walk regressed, not the app. The page has about 200 DOM nodes, and a full
`snapshot` of it takes about 1.2s. The time went to `bin/browse` calls; each
`wait` finished in about 0.6s, which is process startup.

- **Scoped snapshots.** `annotatedSnapshot` (`browse/src/act.ts`) collects
  every `bbx-` id on the page, then makes one `get attr` call per unmatched
  interactive ref until every id is accounted for. A snapshot scoped with `-s`
  cannot contain ids outside its scope, so the loop never stopped early. More
  ids on the page (themed card workspaces, 2026-09-09) made every scoped
  snapshot slower: the Browse-scoped snapshot took 5–13s. Fix: the scan now
  drops ids outside the scope in the same `eval`. The Browse snapshot takes
  1.4s. The ids shown are unchanged (compared before and after on three
  scopes).
- **Unconditional full snapshot.** The card-open step took a whole-page
  snapshot and the URL on every walk, only to fill the error message on
  failure. That cost about 12s. They are now taken only on failure.

Result on this worktree's box: card-open went from 61s to 31s, and the whole
walk from 103s to 75s with a cold restart. What remains is the fixed cost of
the checked click, about 6.5s each and three per walk. A checked click on a
ref without an id spawns about six `agent-browser` processes (URL, ref id,
box, viewport, check, click). That design dates from 2026-08-23, before the
increase, and is left as it is.

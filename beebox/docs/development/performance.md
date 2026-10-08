# Measuring page-load performance

How to measure how fast a box page loads, find where the time goes, and show
that a change made it faster. The tools live in `src/dev/perf/` and the
frontend's bundle analyzer; this page is their manual.

## What a first load spans

A first load of a box page crosses four layers. Measure each one; they fail
in different ways.

1. **Box server start.** The production hub is lazy: a box that has been idle
   is stopped, and the first request for it starts `bbx engine serve`. The
   HTML waits for that start.
2. **Network.** The browser downloads `index.html`, the entry script, and the
   CSS. In production a CDN sits in front of the hub. It compresses text
   (brotli or gzip) and caches the hashed `/assets/*` files. `index.html` is
   not cached.
3. **Boot.** The browser parses and runs the entry script. The app then
   fetches a few things before React renders the shell.
4. **Data.** The shell fires tRPC queries. Some depend on others: the
   conversation resolves before its history loads.

Each layer has a cold and a warm state: a stopped or running box, an empty or
primed HTTP cache. A repeat visit to a running box is the fast case. A first
visit to a stopped box is the slow case.

## The milestones

The web app records `performance.mark` milestones once per page load
(`src/shared/first-load-marks.ts`). DevTools' Performance panel shows them
under Timings, and the harness reads them. The times count from navigation
start.

| Mark | Reached when |
| --- | --- |
| `bbx:entry` | The entry script has been downloaded, parsed, and evaluated. |
| `bbx:render` | Boot work is done and React's first render starts. |
| `bbx:box-validated` | The box list confirmed the URL's box. |
| `bbx:shell` | The product shell (nav, chat) committed. |
| `bbx:composer` | The chat composer committed. Effects run child-first, so this mark can come just before `bbx:shell` in the same commit. The composer is disabled ("Choosing conversation…") until the next mark. |
| `bbx:conversation-ready` | The shell chose the conversation (`chat.bootstrap`, or a fresh reservation). The composer is enabled. |
| `bbx:history` | The chosen conversation's history finished loading and rendered. This is "the page is useful". |

The server records its own startup phases (`src/lib/startup-timing.ts`). A
child's diag-key-gated `/healthz` returns them as `startup`: milliseconds from
process start to the end of `cli-loaded`, `box-checks`, `routes-ready`,
`chat-maintenance`, and `listening`. The hub's `/healthz` reports each box's
`lastStart`: when its child was spawned, and when it answered the readiness
probe.

## The tools

All commands run from `beebox/`.

### `pnpm perf:hub` — a local production-shaped hub

The dev router serves Vite, which loads modules one by one and transforms them
on demand. Its load times say little about production. `perf:hub` runs the
production shape instead:

- a lazy `bbx engine hub` on the built `dist/cli.mjs` and `src/frontend/dist/`;
- an edge stand-in (`hub/edge-proxy.ts`) in front of it, which compresses like the
  CDN does.

```bash
cd src/frontend && npx vite build && cd ../..   # or pnpm build:frontend (adds a typecheck)
pnpm perf:hub up            # a private copy of the worktree's test1 clone; --box <path> for another
pnpm perf:hub seed-chat     # give the box a 40-turn conversation (--turns N), once per copy
pnpm perf:hub status        # URLs, box state, the box's last cold start
pnpm perf:hub cold          # restart the hub: the box is stopped until the next request
pnpm perf:hub down
```

`up` rebuilds `dist/cli.mjs` when backend source is newer. It does not build
the frontend: rebuild it after every frontend change, or you measure the old
code. The hub uses a throwaway session secret and a nonexistent auth file, so
it never touches real credentials. State and logs are in
`~/.cache/beebox/perf/<worktree>/`. Ports default to 3390 (hub) and 3391
(edge).

The hub serves its own copy of the box, in
`~/.cache/beebox/perf/<worktree>/boxes/test1` (`up --refresh-box` copies it
again). A new `bbx serve` kills the box's previous server, so a box that the
dev router also serves makes the two servers replace each other in a loop; the
copy shares only `node_modules` with the worktree's clone. A box passed with
`--box` must not be served by anything else.

A fresh copy has no conversations, so its first load reserves a new chat. A
returning user's box resumes the last conversation instead: `chat.bootstrap`
returns its history, which the page renders. `seed-chat` writes a synthetic
conversation (generic text) into the copy and makes it the box's most active
session, so the measurement takes that path. The transcript goes under
`~/.claude/projects/` for the copy's path, as Claude Code's own do.

### `pnpm perf:load` — measure page loads in a browser

```bash
pnpm perf:load                              # 5 runs: 4G, 4x CPU slowdown, empty cache, running box
pnpm perf:load --box-state cold             # restart the hub before each run: includes the box start
pnpm perf:load --cache warm                 # a repeat visit: prime the cache, measure the second load
pnpm perf:load --profile slow4g --verbose   # slow network; print the median run's request waterfall
pnpm perf:load --trace                      # also save a DevTools trace of each run
pnpm perf:load --target prod --box <slug>   # production, through the real CDN
```

Each run opens a new isolated browser context through CDP (the `bin/browse`
browser, or `--cdp <ws-url>`). A new context has an empty HTTP cache and no
cookies. The run sets the session cookie, applies the network profile (`none`,
`4g`, `slow4g`) and the CPU slowdown (`--cpu`, default 4), and loads the page.
It waits for a mark (`--until`, default `bbx:history`) and then for one second
with no request activity.

The summary gives the median, minimum, and maximum of each milestone. It also
gives main-thread script time, blocking time (the part of each long task over
50 ms), request count, and bytes transferred. With `--box-state cold` it adds
the box start timings from the hub and the child. `--verbose` prints the median
run's waterfall: each request's start, first byte, and end, in milliseconds
from navigation, with size and encoding. Use it to read the critical path.

Every invocation writes a result file to `~/.cache/beebox/perf/results/`. The
file is outside the repository: request paths have no query strings, but a
production run still names a real box. `--trace` files open in DevTools
(Performance panel, "Load profile").

### `pnpm perf:compare` — before and after

```bash
pnpm perf:compare                  # the two newest result files
pnpm perf:compare before.json after.json
```

Prints each metric's median before, after, the change, and the percent. The
header shows both runs' conditions. Compare only runs taken under the same
conditions.

### `pnpm perf:serve-start` — the box server's cold start

```bash
pnpm perf:serve-start              # 5 cold starts of the worktree test1 clone
pnpm perf:serve-start --cpu-prof   # plus a CPU profile, summarized by source owner
```

Starts `bbx engine serve` the way the hub does. It times spawn-to-listening
with a 5 ms poll and prints the child's own phase timings. With `--cpu-prof`
it saves a V8 profile of each start and summarizes the last one. The profile
is mapped through `dist/cli.mjs.map` to the original source and grouped by
owner (an npm package or a `src/` directory). The "attributed" column charges
Node-internal time, such as module compilation and file reads, to the owner
that caused it. The profile files open in DevTools or speedscope.

The box must not be served by anything else; the tool refuses when it is.

### `pnpm analyze:bundle` — what the browser downloads

Run it from `src/frontend/`. It builds with an analysis plugin and prints:

- the initial (eager) and async chunks;
- byte attribution by npm package;
- our own source in the initial chunks, grouped by directory (`--depth N`).

The build replaces `src/frontend/dist/`, the same output a normal build writes.
`--no-build` re-reads the last report.

## A measurement session

1. Build the frontend. Start the perf hub.
2. Take a baseline under the conditions that matter for the change. A useful
   default set:
   - `pnpm perf:load`: a first visit on a good phone connection;
   - `pnpm perf:load --box-state cold`: the same, with the box stopped;
   - `pnpm perf:load --cache warm`: a repeat visit;
   - `pnpm perf:load --profile slow4g`: a slow connection.
3. Make one change. Rebuild what it touches. Measure again under the same
   conditions. Compare with `pnpm perf:compare`.
4. Keep each change separately measurable. Record the before and after numbers
   in the commit or the issue.

Noise: the development machine is busy, so use at least five runs and compare
medians. Each result records the machine's load average; a run taken under a
much higher load than its comparison is not evidence. When a difference is small, run the baseline again in the same
session. Throttling is emulated by Chrome: it shapes bandwidth and latency per
request but does not model TCP slow start or packet loss. The CPU slowdown is
relative to the machine that runs it. Treat absolute numbers as a model; the
before-and-after difference is the result.

## Checking against production

The local setup is a model, so check it against production:

- **Edge behavior.** `curl -sD - -o /dev/null -H 'Accept-Encoding: br' <public-url>/assets/<entry>.js`
  shows the encoding and the CDN cache status. A box's `index.html` names the
  current entry file (`deploy/prod-curl /<slug>/`).
- **Real loads.** `pnpm perf:load --target prod --box <slug>` measures through
  the real CDN from this machine. The session cookie is minted on the server by
  `deploy/prod-session-cookie` and kept in memory only. A production box cannot
  be stopped from here, so `--box-state cold` is local only. A production box
  that has been idle longer than the hub's idle timeout is cold on its first
  load.
- **Box start in production.** The hub's `/healthz` reports each box's
  `lastStart`, and a running child's `/healthz` reports its `startup` phases.
  Both need the diag key, which is in the server's environment.

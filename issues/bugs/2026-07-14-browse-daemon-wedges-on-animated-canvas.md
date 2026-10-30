---
title: browse daemon wedges (os error 35) on pages with continuously animating canvas
workstream: browse-wedge
priority: backlog
---

During figure verification (responsive-figures worktree), `bin/browse` repeatedly
wedged with:

    browse: agent-browser exited 1: ✗ Failed to read: Resource temporarily
    unavailable (os error 35) (after 5 retries - daemon may be busy or unresponsive)

Pattern observed over ~10 occurrences in one session:

- Happens only on pages hosting a continuously animating canvas (p5 figure
  cards with a 60fps `draw()` loop; also right after `reload` on such a page).
- Once wedged, every subsequent command fails the same way; `bin/browse close`
  + reopening the session recovers it reliably.
- Static pages and one-shot commands never triggered it.

Hypothesis: the constantly repainting canvas floods or starves the daemon's
CDP connection so the unix-socket read hits EAGAIN until the retry budget runs
out. Worth reproducing against upstream `agent-browser` and either fixing
there or teaching `bin/browse` to auto-restart the daemon on this specific
error instead of failing the command.

Workaround meanwhile: `bin/browse close` and retry the command in a fresh
session.

## Re-encounter 2026-10-22 (journey walks): no canvas

The same upstream error on a page with no canvas. In the [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) walk (H1), agent-browser 0.27.0 `snapshot` (also `--json` and `-s`) did not return on an unstarted chat whose openers render in the chat column. Left alone, upstream failed after about 154 s: `✗ Failed to read: Resource temporarily unavailable (os error 35) (after 5 retries - daemon may be busy or unresponsive)`. `eval`, `screenshot`, `click`, and `get` kept working. The same URL in a fresh session, with the openers on the Box card, worked in 1 s. Removing `#bbx-nav-session`, `#bbx-nav-place`, or `main` from the DOM cleared the hang; removing the empty-chat block did not. The element is not pinned. The [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) walker hit the same in the same window (H1), and the B walk of 2026-10-09 saw `snapshot` hang until a reload (row 53). The trigger is page state, so the canvas hypothesis is too narrow. The silent exit 1 that the walkers saw is filed separately: [a killed browse command exits 1 silently](../closed/bugs/2026-10-22-browse-command-killed-by-a-signal-exits-1-silently.md).

## Diagnosis and mitigation, 2026-10-30 (browse-wedge)

**Cause.** The daemon wedges when one CDP command never gets an answer. Upstream 0.27.0 has no recovery for that, and its client re-sends each read-only command five times at 30 s each, so every later command fails after about 152 s with the os error 35 text. A `bin/browse` call makes up to five upstream calls (cookie refresh, URL reads, ready wait, the command), so one wedged command cost several minutes. Two triggers reproduce it with bare agent-browser, outside the wrapper:

- A tab that stops responding: `agent-browser eval 'setTimeout(()=>{while(true){}},50); 1'`, then any page command. Permanent until `close`.
- A capture that never gets a frame: SIGSTOP the session Chrome's GPU process (a stand-in for an asleep display), then `screenshot`. The capture fails after 152 s while `eval` and `snapshot` keep working. This is the [screenshot hang](2026-09-20-browse-screenshot-hangs-while-snapshot-works.md).

A continuously animating canvas, repeated `mouse wheel`, and `reload` on a 60 fps canvas page did not wedge it (5–6 tries each). The canvas was not the trigger.

**Upstream.** Fixed in stages: [#2085](https://github.com/vercel-labs/agent-browser/pull/2085) (0.39.1) stops re-sending mutating commands; [#2100](https://github.com/vercel-labs/agent-browser/pull/2100) (0.39.4) reports `page_wedged` and replaces a stuck tab after a second timeout. Measured on the same repro:

| Fault | 0.27.0 (pinned) | 0.39.2 | 0.41.0 |
|---|---|---|---|
| Tab stopped responding | permanent; 152 s per command | permanent; 30–152 s per command | recovers after two failures (~66 s); the tab becomes `about:blank` |
| Capture stalled (GPU paused) | capture fails at 152 s; other commands work | every command blocked until the stall ends | capture fails at 30 s; other commands recover |

0.39.2 is the newest version the repository's 7-day `minimumReleaseAge` allows, and it is worse than 0.27.0 for a stalled capture, so it was not adopted. 0.39.4 is allowed from 2026-11-02 and 0.41.0 from 2026-11-05. On 0.41.0, `click`, `eval`, and `screenshot` on a stuck tab still report os error 35 instead of `page_wedged`, and the switch to a blank tab is not reported; an upstream issue draft covers that.

**Mitigation in bin/browse (713bf637e).** A running daemon gets a 10 s `get url` probe before each command; with no answer, the command fails at once with "the browser did not answer within 10 s … run `bin/browse close`". `close` clears it in about 30 s. `snapshot` and `screenshot` stop at 45 s and name the likely cause. Measured on the stuck-tab repro: 10.3 s per command, against about 152 s per upstream call before.

**Upgrade to 0.41.0, 2026-10-30.** The boxholder approved 0.41.0 inside the release-age gate; `pnpm-workspace.yaml` excludes that one version by name. Measured through `bin/browse`:

- Tab stopped responding: each command fails at the 10 s probe; upstream replaces the tab with `about:blank` after about 80 s, and `close` now clears it at once (was about 30 s).
- Capture stalled: `screenshot` fails at 30 s with upstream's os error 35, which the wrapper now reports with the display-asleep hint; `get url` and `snapshot` keep working, and captures work again once the display wakes.
- `mouse wheel` also fails at 30 s while the display is asleep, and works at once when it is awake.

The upgrade exposed an upstream regression: a command sent with a different `AGENT_BROWSER_DEFAULT_TIMEOUT` makes the 0.41.0 daemon restart its background state (`restartedBackground: true` in `snapshot --json`), and `snapshot` then returns the tree from before any later change the page makes by itself. The wrapper set that variable on every page-ready wait, so on the app every snapshot showed the "Starting your box…" splash. 0.41.0 honors `wait --timeout` (default 25 s), so the wrapper now passes `--timeout` and no longer varies the env. Repro (bare agent-browser 0.41.0): `open` a page that replaces its content by `setTimeout` after 1.5 s, run `AGENT_BROWSER_DEFAULT_TIMEOUT=5000 agent-browser wait 2500`, then `snapshot`: it shows the old content.

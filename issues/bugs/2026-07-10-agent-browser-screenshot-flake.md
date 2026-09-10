---
title: "agent-browser screenshot op flakes with os error 35"
workstream: unknown
area: bin
filed-by: agent
priority: important
next-action: discuss
---

> **Trigger fired 2026-09-09 — no longer a flake, and no longer dormant.**
> `screenshot` now fails **every time** in the `tour-check` worktree, on a fresh
> daemon, including against a trivial static `file://` page with no beebox app
> involved. Every tour aborts at its first checkpoint, so the weekly tour check
> produced no artifacts at all. Moved out of `watch/`: this blocks a scheduled
> job today and the next step is ours to take. Details in "2026-09-09" below.
> Still root-caused UPSTREAM in `vercel-labs/agent-browser` (`connection.rs:1032`
> — `is_transient_error` string-matches `(os error 35)`, which also matches an
> expired `SO_RCVTIMEO` read), shipping as a precompiled binary we can't patch.

`bin/browse screenshot` (and therefore every tour checkpoint)
intermittently fails with `Failed to read: Resource temporarily
unavailable (os error 35) (after 5 retries - daemon may be busy or
unresponsive)` while navigation/snapshot/eval against the same daemon
keep working. Observed repeatedly on 2026-07-10 in the
unify-capture-input worktree: interactive `bin/browse screenshot`
during a capture-mode walkthrough, and both viewport passes of
`bin/tour capture` twice in a row (see
`beebox/test/tours/.artifacts/capture/2026-07-10T13-46-44-961Z/summary.md`),
including with zero other active sessions. Pre-existing — artifacts
from earlier the same day and the capture-mode Track 4 session show the
identical failure.

Screenshot-specific (larger response payload over the daemon socket?),
so likely an agent-browser read-timeout/buffering issue rather than
contention. Worth reproducing against upstream `agent-browser`
directly, checking its socket read loop for EAGAIN handling, and — if
it's payload-size-related — whether `screenshot --full` fails harder.

Until fixed, tours can't reliably produce their core artifact; the
fail-findings they now record at least make the flake visible in
summary.md instead of silently missing screenshots.

## Research (2026-07-11)

Reproduced twice (worktree-fix-bugs bug-queue validation) — and it's worse
than filed: after the "os error 35 (after 5 retries)" wait failure, the
follow-on screenshot capture hung indefinitely (5+ min, no file), daemon and
Chrome confirmed healthy throughout. Root cause pinpointed **upstream** in
`vercel-labs/agent-browser` (Rust CLI, ships as a precompiled binary — not
patchable via `pnpm patch`):

- `cli/src/connection.rs:1032` `is_transient_error` string-matches
  `(os error 35)` (macOS EAGAIN) as retry-worthy — but on macOS an expired
  `SO_RCVTIMEO` read (set at `connection.rs:1073`, 30s floor) surfaces as the
  SAME `os error 35` string. A command whose server-side work legitimately
  approaches the per-attempt read timeout — the `wait --fn` long-poll
  `bin/browse` issues before every screenshot, or a large base64 PNG payload —
  gets its connection torn down and the WHOLE command restarted from scratch
  (`send_command_once`, `connection.rs:1091`), up to 5 times, then fails even
  though the daemon was never stuck.

Our wrapper (`browse/src/cli.ts`, `browse/src/screenshot.ts`) is a thin
pass-through with no bug of its own. Decision needed: file this upstream
(report is ready — the file:line citations above), and/or add a stopgap outer
retry with a longer budget in `browse/src/cli.ts` — which papers over the wait
failure but can't prevent the post-failure indefinite hang observed here.

Data point (2026-07-14, quick-seeing-p5js worktree): worse variant again — a
successful `open` of a local `file://` page (title returned correctly), then
every subsequent command wedged: `screenshot` (repeated "page-ready wait timed
out; agent-browser exited -1"), then `get title`, `close`, and re-`open` all
hung past 30–60s timeouts, and the hang **survived `pkill -f agent-browser`**
plus a fresh daemon start. Not screenshot-specific in this mode; the whole
per-worktree daemon channel was unusable and never recovered in-session.

## Re-encountered 2026-09-09

Seen during interface-as-cards UI verification.
With agent-browser 0.27.0, `bin/browse screenshot` stalled for minutes and
ended with `agent-browser exited -1` and no output. Navigation, DOM eval,
and accessibility snapshots still worked. Both the default session and a
fresh `--session interface-evidence` reproduced it.

One capture returned a stale-looking 500×844 image showing the generic
“Choosing conversation” state while current DOM probes showed Browse and
the composer at 1280×800. Its sidecar named the current URL, but
`browse/src/screenshot.ts` reads URL/title after capture, so that metadata
does not prove the pixels represent the same state.

Skipping the wrapper ready wait, restarting the worktree browser, launching
with `AGENT_BROWSER_ARGS='--disable-gpu'`, and selecting current tab `t1`
did not restore reliable screenshots. No mechanism was established for this
occurrence. Upstream capture uses native CDP `Page.captureScreenshot`; this
is not a Playwright font-readiness wait. Do not assume the older socket
timeout diagnosis explains the stale pixels.

The [closed ready-wait/profile issue](../closed/bugs/2026-08-15-browse-screenshot-hangs.md)
has its fixes in place and describes different mechanisms; it was not reopened.
This recurrence blocks screenshot exhibits despite usable DOM verification.
The developer decision is whether to schedule a focused capture-tooling
diagnostic now rather than wait for another upstream release. No tooling
change was made in the interface-as-cards workstream.
## 2026-09-09: deterministic, and it blocks the weekly tour check

The weekly `tour-check` run (`20260909-184538`) produced **zero checkpoints
across every tour**. Each tour aborted both viewport passes on its first
`bin/browse screenshot`, each burning ~320s (5 × ~30s retries) before failing:

```
❌ camera-off [desktop] — pass aborted: bin/browse --session tour-capture-desktop
   screenshot …/camera-off.desktop.png exited 1: browse: agent-browser exited 1:
   ✗ Failed to read: Resource temporarily unavailable (os error 35)
     (after 5 retries - daemon may be busy or unresponsive)
```

Isolation done in that run, narrowing from "tours are broken" to "the tool's
screenshot path is broken":

- **Not contention, not a wedged daemon.** Killed the worktree's `agent-browser`
  daemon and its Chrome processes, re-ran a single tour on the fresh daemon:
  identical failure, identical timing.
- **Not the tours.** `bin/browse --session diag screenshot` fails the same way
  standalone.
- **Not the app, and not the dev router.** The router answers in ~7ms, and
  `open` succeeds and returns the right page title (`✓ Dashboard — test1`) —
  navigation, snapshot and eval all keep working. Only `screenshot` fails.
- **Not beebox at all.** Calling upstream `agent-browser` directly (bypassing
  `bin/browse`) on `file:///tmp/diagpage.html`, a one-line static HTML file,
  reproduces it: `open` returns in 1.4s, `screenshot` fails after 2m32s.

That last one is the reproduction against upstream this issue asked for, and it
rules out the earlier payload-size and animating-canvas hypotheses — an `<h1>hi</h1>`
page has neither. `agent-browser` is still 0.27.0; nothing bumped it, so the
change is environmental rather than a new release.

The consequence is what makes this actionable now: **tours and any other
screenshot consumer are dead**, not degraded. `bin/smoke` shares the browser
library, so it is worth checking whether the merge gate is affected the same way.

The stopgap this issue previously sketched — an outer retry with a longer budget
in `browse/src/cli.ts` — does not help this mode. The read is not losing a race;
five consecutive 30s attempts each expire, so a longer budget just fails slower.

---
title: "agent-browser screenshot op flakes with os error 35"
area: bin
filed-by: agent
---

> **Watch (moved to watch/ 2026-08-06).** Root-caused UPSTREAM in
> `vercel-labs/agent-browser` (`connection.rs:1032` — `is_transient_error`
> string-matches `(os error 35)`, which also matches an expired `SO_RCVTIMEO`
> read), which ships as a precompiled binary we can't patch. Dormant lately (tours
> / screenshots not run heavily) — NOT fixed. **Re-check trigger:** a new
> `agent-browser` release (does its retry logic now distinguish EAGAIN from an
> expired read-timeout?), or the next time it bites during a tour/screenshot run.
> If it resurfaces before upstream fixes it, the local stopgap is an outer retry
> with a longer budget in `browse/src/cli.ts` (papers over the wait failure; can't
> prevent the post-failure indefinite hang the research also saw).

`bin/browse screenshot` (and therefore every tour checkpoint)
intermittently fails with `Failed to read: Resource temporarily
unavailable (os error 35) (after 5 retries - daemon may be busy or
unresponsive)` while navigation/snapshot/eval against the same daemon
keep working. Observed repeatedly on 2026-07-10 in the
unify-capture-input worktree: interactive `bin/browse screenshot`
during a capture-mode walkthrough, and both viewport passes of
`bin/tour capture` twice in a row (see
`callback-box/test/tours/.artifacts/capture/2026-07-10T13-46-44-961Z/summary.md`),
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

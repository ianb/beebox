# agent-browser screenshot op flakes with os error 35

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

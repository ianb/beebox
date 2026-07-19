---
title: "Unauthenticated /api/csp-report can exhaust memory/disk (no per-report size or count bound)"
filed-by: agent
discovered-in: worktree-local-password-auth — Codex adversarial review of the always-on-auth branch (finding #7, pre-existing)
area: callback-box
---

Surfaced by a cross-model (Codex) security review of the local-password-auth
branch; **pre-existing**, filed rather than fixed on that branch.

`/api/csp-report` (`src/webapp/routes/api-csp-report.ts`, around lines 101 and
117) is public (it must be — browsers post CSP violation reports without a
session) and accepts the server-wide JSON body limit (~50 MB). It has no
per-report field-length or report-count bound: it builds all output lines in
memory, appends them to the log, then re-reads the entire log when it grows
oversized. A single report with a ~49 MB `documentURL` produces one enormous
line; the half-file truncation can leave tens of megabytes because the retained
half may contain no newline to split on. Repeated posts are a cheap
memory/disk-amplification vector against an unauthenticated endpoint.

Fix direction: cap individual field lengths (e.g. truncate `documentURL`/
`blockedURL` to a few KB), cap the number of directives logged per request, set
a small dedicated body limit on this route (CSP reports are tiny), and make the
log rotation newline-aware so truncation can't retain a giant partial line.

## Research (incomplete)

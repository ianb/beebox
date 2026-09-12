---
title: "The secret access log is never pruned, and 99% of it is one health check's probe"
workstream: unattached
area: beebox
labels: [secrets]
filed-by: agent
discovered-by: agent
discovered-in: worktree-finish-migrations — closing the secret-store transition window
needs: [decision]
---

The secret access log has no retention policy, and almost everything in it is
one repeated probe rather than real activity. Two separate problems that
compound: nothing deletes the log, and the log is roughly 100× larger than the
access it records.

## Nothing prunes it

`core/secrets/access-log.ts` writes monthly segments
(`~/.config/beebox/secrets-log/YYYY-MM.jsonl`). Nothing ever deletes one:
`secretsLogDir()` has exactly two callers (the writer and the store), and
there is no `unlink` anywhere in `core/secrets/`. The module's own docstring
assumes deletion happens — *"deleting an old segment never loses the latter"*,
about `lastUsed` on the store entry — so the design anticipated a sweep that
was never written.

Measured 2026-09-11: 52 MB on the server across two segments (~6 weeks, so
roughly 450 MB/year), 15 MB on the dev machine. Not urgent at the current disk
margin, but it is monotonic, and the server has hit 100% of this volume before
(see the disk-pressure history in `closed/`).

For comparison, the neighbours that do bound themselves: `scheduler.jsonl`
rotates at 1 MB and keeps the back half
(`core/schedule/scheduler.ts:87`), and the event bus is pruned to 24 hours —
though only at server start (`webapp/server.ts:260`), so a long-lived process
grows until the next restart. The usage session manifest is the other
never-rotated file (`core/usage.ts:124` says so in its own comment); it is
20–70 KB per box today, so it is a footnote here, not the problem.

**The decision this needs:** how long access history is worth keeping. The log
buys attribution — which box used which secret, when, for what — so retention
is a judgment about how far back that question is ever asked, not something an
agent should pick. Once chosen, the sweep itself is small (delete segments
older than N months, on the same cadence as any other maintenance tick).

## Almost all of it is `checkMissingConnectors`

September on the server: ~93,820 `resolve` events for
`google-oauth-client-id` and ~93,819 for `google-oauth-client-secret`, out of
~95,000 events total. Every other secret in the fleet accounts for about 1,500
events combined.

The source is `connectors/requirements.ts:44`, which calls
`getBoxGoogleClientCreds(boxRoot)` to answer "is Google configured for this
box". `checkMissingConnectors` runs from the scheduler health path
(`core/schedule/health-box.ts:24`) and both tick helpers
(`cli/commands/tick-utils.ts:18`, `cli/commands/tick-helpers.ts:13`), so every
tick for every box resolves both names and logs two lines — to ask a
configuration question, not to use a credential.

The same pattern produces the mirror-image noise on the dev boxes, where the
answer is "no": ~34,000 `unknown-secret` refusals per month per name, because
neither test box has a google-oauth entry. Those fail closed and are harmless,
but they are the bulk of the dev log.

This is worth fixing regardless of the retention decision, and it shrinks that
problem by two orders of magnitude. It also restores what the log is for: real
attribution is currently 1 line in 100.

Worth settling as part of it: whether an existence check should reach the
access log at all. A "is this configured" probe is not an access, and the
store already knows the answer without resolving a value — a grant lookup
would answer `checkMissingConnectors` without minting a log line. That may be
the whole fix.

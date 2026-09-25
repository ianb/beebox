---
title: "Codex `login status` times out after 10s on the dev host, so the admin page shows an error badge for a box that may simply not be logged in"
workstream: unattached
area: beebox
labels: [admin, codex]
filed-by: agent
discovered-by: agent
discovered-in: worktree-admin-structure — walking the admin page on the local test1 box
---

The Codex section of the admin page on the local `test1` box renders a
"Status unknown" warning badge with the detail `codex login status timed out`.
The text comes from `beebox/src/services/codex-cli.ts`, which spawns
`codex login status`, waits ten seconds, then kills it and reports
`inconclusive`.

Two things are wrong, and it is not yet known which applies here:

- **The CLI may hang rather than answer.** `codex login status` should return
  in well under a second. If it blocks when no credentials exist (waiting on a
  TTY, a keychain prompt, or a network call), the ten-second timeout is masking
  a hang, and every admin load on such a host pays ten seconds for that
  section.
- **The page treats "inconclusive" as an error.** A boxholder who has never
  logged in to Codex sees a warning badge and an error line instead of "Not
  logged in" with a login button. The section already distinguishes
  `logged-out` from `inconclusive`; the question is whether `inconclusive`
  should be presented as a failure when the more likely state is "no account".

Reproduce: open the admin page on a box whose host has the `codex` binary but
no Codex login; watch the Codex section for ten seconds.

Related: the admin overview being built in `worktree-admin-structure` surfaces
this same status as a one-line summary, so the presentation question applies
there too.

## What was established (2026-09-25, worktree-admin-structure)

`codex login status` answers in about 0.15 s on this host when run by hand,
and a later admin load reported "Logged in", so the timeout is intermittent,
not a hang on every load. The cause of the slow instance is not known; a
concurrent `codex exec` review was running on the machine around the same
time and is the leading suspect.

Fixed the two things that were wrong regardless of cause:

- The service now logs a `console.warn` when the ten-second timer fires,
  with how many bytes the CLI had printed, so the next occurrence carries
  evidence of hung-versus-slow. The detail text a boxholder sees is
  "Codex did not answer within 10 seconds. Refresh to check again."
- The Codex section shows an unanswered probe as a neutral "Not checked"
  badge with that guidance, keeps the Authenticate and Refresh buttons, and
  no longer offers Log Out for an unknown state. The admin overview says
  "Not checked: Codex did not answer" with a warning tone instead of an error.

Left open until a timeout recurs with the new log line: whether something in
the CLI blocks under concurrency.

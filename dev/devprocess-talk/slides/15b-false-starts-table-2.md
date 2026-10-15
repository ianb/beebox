# False starts, in and out
## Supporting: the table, part 2, and rules that vanished
| What | In | Out | Reason, as recorded |
|---|---|---|---|
| finish agent at 624 lines | Aug 8 | Aug 25 | "drops from 562 lines to 150: the mechanics the scripts now own are gone" |
| Fast-forward-only landing | Aug 8 | Aug 24 | one visible merge commit per landing |
| Browser triage committing frontmatter | Aug 13 | Oct 5 | "stranded commits on whichever worktree branch held the issue" |
| Hourly reporter blaming itself | Aug 25 | Aug 27 | thirteen issues for one failure |
| Post-merge auto-sweep | Jul 11 07:04 | Jul 11 18:09 | raced the deploy; "failing the prod deploy (seen repeatedly)" |
| Codex write grant to the main checkout | Aug 4 | Aug 4 | "it never worked… The grant delivered nothing and only weakened isolation" |
| Speculative finish guidance | Aug 8 | Aug 8 | "generalized from a handful of probes rather than observed failures" |
| stack-decisions as a live doc | Mar 2 | Sep 12 | frozen as a dated report |

- Package CLAUDE.md rules that came and went: a flake workaround note (added and removed Jun 21, once the cause was found); "Don't invent card XML formats" (Mar 6 → May 5, "a box-side concern"); "Read before writing" (Mar 6 → Sep 12, dropped in calibration and not restated)
- Reverts: 13; the fastest two minutes after the commit; one (Sep 5) because "cross-model review found the removal silently drops the only record of a capture's media. The suite stayed green through all of it"

Notes:
The Sep 10 revert of an iOS voice track came with "a scope circuit breaker" added to the plan skill nine minutes later.

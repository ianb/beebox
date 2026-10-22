# False starts in unattended work
## Supporting: in, out, why
| What | In | Out | Why |
|---|---|---|---|
| Four hand-rolled launchd jobs | Jul 10, Aug 6 | Aug 24 | "a booted-out label whose file survives comes back at the next login, and the SDK job would run twice a day from two mechanisms" |
| sdk-update running in the main checkout | Aug 24 | Aug 24 | "could commit over uncommitted work or under a live session" |
| Post-merge auto-sweep | Jul 11, 07:04 | Jul 11, 18:09 | `git worktree prune` raced the deploy on the same trigger, "failing the prod deploy (seen repeatedly)" |
| Hourly reporter blaming its own commits | Aug 25 | Aug 27 | thirteen issues for one failure |
| Headless sessions backgrounding the suite | Aug 24 | Oct 6 | "a headless session that backgrounded the suite and ended its turn never came back; its uncommitted edits then made every later merge refuse; committed work sat on schedule branches for weeks" |

- The Oct 6 fix parks leftover edits, lists unlanded commits, can replay a handoff, and disables background tasks for headless runs
- The lesson was then written into the root instructions for every subagent: run long commands in the foreground

Notes:
Each of these was an operational surprise rather than a design error; the pattern is that an unattended system needs a record of what it did not finish.

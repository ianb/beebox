# One checkout per line of work, one router for all
## Supporting: the May 26 landing (967b776af, 96932b6df, 6babebd70)
- Each worktree: its own branch, its own clone of the test box, its own browser daemon
- The router cold-starts a worktree on first request and stops it after five idle minutes
- Finish: merge main in, run checks, land; session end removes merged worktrees
- Today: 548 worktree landings from 191 distinct names; 7 live worktrees against 155 workstream records

```text
http://localhost:3210/<main|worktree>/<box>/...
```

Notes:
The cost of sharing one process across every session shows up as 451 lines of router protocol docs and a rule that no worktree may restart the router without asking.

---
name: box-work
description: Rules for running commands, tests, or agents against a box from the dev repo. Use before you run against a box, use the test box (test1 or a worktree's clone), make a throwaway box, pick a box directory or --box path, or look at prod.
---

# Box work

Read `beebox/docs/box-work.md` for the task at hand. Three rules apply before anything runs:

1. A box path is absolute and outside every git repository, `scratch/` included. A nested box sends its git and annex commands to the enclosing repo.
2. Never change credentials to unblock yourself. The auth and secret stores are shared by every box on the machine; at a login wall, ask the boxholder.
3. Nothing read from a real box or production goes into a public issue, commit message, doc, or fixture without the boxholder's scrub. Use `private-issues/` or ask.

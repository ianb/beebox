---
title: "bin/finish-verify --help runs the full verification, and interrupting it leaves children running"
workstream: finish-tooling
area: bin
labels: [finish, cli]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
resolution: implemented
---

**Closed 2026-10-12 (finish-tooling).** `finish-verify` and `finish-preflight`
now parse their arguments strictly. `--help` prints usage and exits 0;
preflight's `--help` used to merge main. An unknown flag or `--only` kind
exits 2. Each check runs in its own process group, and
SIGINT/SIGTERM/SIGHUP to finish-verify reach that group (exit 128+n). Runs
register under the git common dir, and a run that finds another live one
prints a note naming its worktree. Test: `bin/test/finish-verify.doctest.md`.

`bin/finish-verify.ts` reads only `--sheet` and `--only`; any other argument,
including `--help`, falls through to a full run (preflight sheet, selected
tests, smoke). Three sessions probed it with `--help` and started a 10+ minute
run; one interrupted it, and its verifier descendants kept a test slot.

Coding feedback: theme-polish/20261009T025548Z-landed.md,
blank-assistant-message/20261009T013105Z-landed.md,
hq-always/20261010T143901Z-landed.md (two stray full runs; the second
concurrent verify on the shared router also made smoke miss its 120 s budget).

Wanted: `--help` prints usage and exits; unknown flags exit 2; Ctrl-C kills
the child process group. Related, from the same hq-always entry: concurrent
finish-verify runs from different worktrees are not detected.

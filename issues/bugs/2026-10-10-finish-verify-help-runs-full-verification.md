---
title: "bin/finish-verify --help runs the full verification, and interrupting it leaves children running"
workstream: unattached
area: bin
labels: [finish, cli]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

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

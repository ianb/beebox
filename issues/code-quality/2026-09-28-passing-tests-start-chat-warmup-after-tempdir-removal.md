---
title: "Passing tests emit chat warm-up failure after temporary directory removal"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: jev-triage — change-selected test run
---

On September 28, `pnpm --dir beebox test:changed` passed all 145 files and
1,911 assertions but emitted `Chat backend warm-up failed, will cold-spawn on
next start`. Its SDK subprocess said: `The current directory no longer exists
(it was deleted or moved). Start Claude Code from an existing directory.`
The run reported host memory pressure. The originating test is not isolated.

The triage work changes only a Gmail validator re-export in production code;
it does not change chat warm-up or temporary-box teardown. Investigate which
test starts the real warm-up and whether shutdown awaits or cancels it before
removing its box. A passing run should not leave this background failure
unexplained. This observation does not authorize test infrastructure cleanup.

Searched the full queue for the diagnostic. Existing closed chat polling and
history-backfill teardown issues concern different operations; neither records
this SDK warm-up failure.

---
title: "Passing tests emit chat warm-up failure after temporary directory removal"
workstream: test-suite-health
area: beebox
filed-by: agent
discovered-in: jev-triage — change-selected test run
resolution: implemented
---

**Closed 2026-10-06 (test-suite-health, `d8f88e44e`).** Originating test: `beebox/test/webapp/trpc/routers/chat.model-policy.doctest.md`, which reserves chats on a test server with the real chat backend. Each reserve prewarms a Claude Code subprocess, and shutdown neither waited for nor cancelled it: `closeWarm()` only bumped an epoch, and a prewarm still probing box files spawned after shutdown, in the deleted directory. `closeWarm()` now aborts in-flight startups and resolves when they settle, `registry.shutdown()` awaits it, and the registry's lifetime signal stops a post-probe spawn. The doctest printed the warning twice per run before and not at all in three runs after. New example in `registry.doctest.md` fails without the post-probe check. Chat, registry, runtime and maintenance doctests: 402/402. The test still uses the real backend, as before; switching it to the fake was not part of this.

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

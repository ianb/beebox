---
title: "`core.turn-timeout.test.ts` is red: \"A capped turn still times out\" never finishes"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — full suite after the Agent SDK 0.3.318 bump
labels: [test-failure]
---

`beebox/test/services/codex-sdk-session/core.turn-timeout.test.ts` fails on
current main every run, in under a second:

- "A capped turn still times out": `test unfinished`
- "The chat backend asks for no turn cap": `child test left in queue`

The test arrived with `d842dbe3e` ("Remove the wall-clock cap on Codex chat
turns", 2026-11-06), which also reworked `src/services/codex-sdk-session/core.ts`.
The capped-turn example ends before its timeout fires, so tap reports it
unfinished and never starts the next example. Neither file imports the Claude
Agent SDK, so the SDK bump that surfaced it is not involved.

Reproduce, from `beebox/`:
`npx tap --disable-coverage test/services/codex-sdk-session/core.turn-timeout.test.ts`
(2 of 4 fail).

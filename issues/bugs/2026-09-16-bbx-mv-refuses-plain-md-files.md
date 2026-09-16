---
title: "bbx mv rejects a plain .md file, but the agent guide says it moves one"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

`bbx mv some-note.md dest/` fails with
`Source must be a .card file or directory`
(`beebox/src/core/commands/move.ts:210`).

The agent guide says `bbx mv` handles "a card, a directory, or a plain `.md`
dossier" (`beebox/src/core/agent-guide/cards.ts:133`). The SDK hook text says
the same (`beebox/src/core/sdk-hooks.ts:144`). `move-operations.ts` already
walks dossiers for link rewriting inside a directory move.

A box agent doing a layout refactor fell back to `git mv` and rewrote refs by
hand for six files.

Either accept a single `.md` source or correct the guide and the hook text.
Accepting it matches what agents are told.

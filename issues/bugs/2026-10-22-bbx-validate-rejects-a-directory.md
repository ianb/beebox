---
title: "`bbx validate <dir>` fails with \"not a card or markdown file\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — I-deciding walk, 2026-10-22
---

In the I-deciding walk the box agent ran `bbx validate _content/projects/washing_machine 2>&1 | tail -3`. The command failed with `Error: not a card or markdown file: …/washing_machine`. The pipe hid the exit status, and the agent committed. One card in that directory had a broken table row that validation would not have caught anyway.

`collectExplicitResults` rejects every path that is not a card or a Markdown file (`beebox/src/cli/commands/validate/command.ts:208-216`). `beebox/box-docs/bbx-commands.md` documents `bbx validate <path>` and does not say that a directory is refused.

Report: [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (R9).

## Why the fix is not obvious

Two fixes are possible: accept a directory and validate the cards in it; or say "card file" in the docs and in the error text. Accepting a directory needs a rule for ignored and non-card files under it.

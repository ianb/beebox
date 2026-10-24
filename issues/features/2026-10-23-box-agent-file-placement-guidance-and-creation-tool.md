---
title: "The box agent has no single guidance or tool for where and when to create files and folders"
workstream: unattached
area: beebox
labels: [agent-guidance]
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder idea, 2026-10-23
---

A box agent creates files and folders all the time: cards, landmark folders,
`.attach` files, scripts, scratch files, notes. Guidance on where each one goes,
and when to create one at all, is spread across the box docs (one
`card-<type>.md` per type, `box-shape`, the agent guide sections in
`beebox/src/core/agent-guide/guide/`). Some placements have their own rules,
such as `tmp-upload/<batch-slug>/` in `card-upload-batch.md`, and the
[one temp-file convention](../closed/docs-and-chores/2026-08-03-one-temp-file-convention-for-agents.md)
issue fixed one case. No single place answers "I am about to make a file: where
does it go, and should it be a card, a plain file, or nothing?"

Two consequences:

- **Inconsistent layout.** Agents invent placements, so two boxes, or two
  sessions in one box, organize the same kind of thing differently.
- **Features go unused or misused.** A plain file where a card type exists
  loses its view, search fields and links. A new folder where a landmark
  belongs is not a place in the app. A card where an `.attach` file belongs
  clutters browse.

## Proposal (boxholder, 2026-10-23)

1. **Placement guidance.** Short, concrete advice for each kind of thing an
   agent creates: where it goes, when to create it, and which box feature it
   should use. The goal is to normalize layout and steer agents to the right
   feature.
2. **A creation tool.** A command that creates files the right way, such as
   an extended `bbx create` (today it makes a card from a template,
   `beebox/src/cli/commands/create.ts`) or a new command. The tool's name gives
   the guidance something concrete to point at ("use `bbx …` to make X"). It
   also lets the code apply placement rules, which prose can only suggest.

## Research (incomplete)

- Inventory what agents create in practice: git history of test boxes and
  journey-walk boxes, and the after-action reports in
  `beebox/test/user-stories/journeys/*/reports/`. Which placements vary, and
  which features get missed?
- Inventory the placement rules that exist today and where each is written.
- Decide which rules belong in a tool (mechanical: paths, naming, folder
  creation, landmark registration) and which stay as judgment in guidance
  (card versus plain file versus no file).
- Check fit with existing commands (`bbx create`, `bbx mv`, `bbx location`,
  `bbx upload`) before adding one. Use the bbx-context skill for where the
  guidance lives, and a box knowledge audit to test that agents learn it.

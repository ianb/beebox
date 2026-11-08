---
title: "Box agents use `bbx chat screenshot` to check their own visual work; narrow it to \"what the person sees right now\" and route self-checks elsewhere"
workstream: agent-self-view
area: beebox
labels: [agent, screenshots, guidance, verification]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-11-06"
---

The boxholder sees box agents use `bbx chat screenshot` often and to little
effect. Its purpose is narrow: to see exactly what the person is looking at
right now, their whole screen as context. It is not a way to look at a
specific card, view, or component the way a person would. An agent checking
its own visual work gets a picture of whatever the person has open, in the
person's viewport, and can do almost nothing useful with it.

The boxholder's view: the feature is barely worth keeping for its real
purpose, and the self-checking cases need proper instructions and tools
instead.

Where agents are told to use it today:

- `beebox/src/core/chat/session/prompts.ts` (about line 145): "When
  appearance is the question — a layout, a visual bug, an unexpected
  rendering — `bbx chat screenshot` returns an image path to Read: a real
  capture of the user's screen right now". This invites the self-check use.
- `beebox/src/core/box/guidance-sync/skills/content.ts` (about line 226): a
  skill tells the agent to run it when the user says a view "looks wrong".
- `beebox/src/core/docs-gen/package-docs/bbx-commands-scheduling.ts` (about
  line 180): the command reference.
- `beebox/src/core/agent-guide/ledger.yaml` (about line 505): the ledger rule
  for when each chat command applies.

To do:

1. Rewrite those passages so the screenshot is for one case only: the person
   refers to what they are looking at ("this", "here", "what I'm seeing") and
   the open-card snapshot does not say enough. Say plainly that it is not a
   way to look at a card, view, or the agent's own output.
2. Point the self-check cases (did my view render, does this card look right,
   is the layout broken) at a tool built for that. The tool does not exist
   yet. See [box agent cannot see its own visual work](2026-10-29-box-agent-cannot-see-its-own-visual-work.md):
   a server-side render of a named card or view at set widths, plus its text
   and accessibility tree. Until it exists, the guidance should say to
   check with `bbx view check`, typecheck, and the source, and to ask the
   person to look, instead of taking a screenshot of their screen.
3. Decide whether to keep `bbx chat screenshot` at all, given how narrow its
   real use is. Measure first: count its uses in recent box transcripts and
   sort them by reason (the person's context versus a self-check).
4. After changing the guidance, run a box knowledge audit (the
   knowledge-audit skill) to confirm agents reach for the right tool.

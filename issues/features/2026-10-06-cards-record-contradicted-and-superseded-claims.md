---
title: "Cards record when a new source contradicts or supersedes a claim, instead of silently replacing it"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — from the Karpathy "LLM Wiki" review
---

When a new source disagrees with a claim already on a card, the agent today
edits the card and the old claim disappears. It survives only in git history,
which nothing reads. The card should say that the claim changed, cite both the
old and the new source, and leave the reader able to tell a correction from a
contradiction that is still open.

This matters most for this box's subject matter, people and plans, where
facts expire: an address that changed, a plan that was replaced, a preference
someone revised.

Origin: the one idea kept from the
[LLM Wiki review](../closed/exploration/2026-09-16-karpathy-llm-wiki-pattern.md).
Verified absent on 2026-09-17: no such concept in `beebox/src/`. The nearest
relative is the personality card's `source: user-stated | inferred` on beliefs
(`beebox/src/schemas/personality/schema.tsx`), which is belief revision in one
narrow place.

## Questions

- Representation: a body convention the agent writes (for example a short
  "Changed" note with both sources), a Markdoc tag, or a structured field on
  the schemas where it matters (person, plan, briefing).
- Which writers must follow it: capture filing, narration, connectors that
  update cards, and chat edits.
- How an open contradiction surfaces to the boxholder (a question card, a
  notification, or only on the card).
- Agent guidance and a knowledge audit: give the agent a card plus a
  disagreeing source and check that it records both.

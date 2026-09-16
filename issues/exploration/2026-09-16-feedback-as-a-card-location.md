---
title: "Replace the bbx feedback command with a directory of feedback cards"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — production box feedback triage (bbx feedback)
---

The boxholder: "I feel like we can simplify feedback by just making it a
location where cards go, and not a whole command."

The box agent's experience after a week: each note it filed wanted a title, a
body with quotes and links, and sometimes a reference to an earlier note. It
had to put all of that into one shell-quoted string. Several notes on the
production box are follow-ups to earlier ones, linked only by prose.

If `_config/feedback/` held ordinary cards, agents would write them with the
normal card tools: a markdown body, `{% quote %}` for the boxholder's words, a
ref to an earlier note, `contains:` for search, and a normal commit. The
command would become a convenience that creates one card, or be removed.

## Open questions

- `bbx feedback` attaches session context (recent transcript turns). A card
  would need another way to get that, or lose it.
- The `feedback` card type already exists for boxholder responses to editions
  (`beebox/src/schemas/feedback.tsx`). Pick a different type or merge the two.
- `feedback-review/collect.ts` matches files by timestamped filename. It
  would need to read cards instead.

Related: [introspectable feedback storage](2026-05-19-introspectable-feedback-storage.md),
[bbx feedback rejects its own transcript](../bugs/2026-08-12-bbx-feedback-rejects-its-own-transcript.md),
[feedback collection cadence](../docs-and-chores/2026-07-14-feedback-collection-cadence.md).

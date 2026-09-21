---
title: "Plan template has no section for developer-only notes, distinct from what the next agent reads"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A developer, thinking out loud about their own planning process, floated a
gap: a plan document currently has one audience. `.claude/skills/bbx-plan/SKILL.md`
instructs writing "for a reader six months from now with no context" and every
section in `TEMPLATE.md` is filled for that reader, who is usually the next
agent executing or reviewing the plan. There is no section marked as
developer-only commentary that an executing agent should read as context but
not as scope or instruction — for example, a running assessment of whether
cross-model review is surfacing the real tradeoffs or just rubber-stamping the
last draft, which is exactly the kind of note that prompted this idea.

Today the only way to keep a note out of the agent-legible plan is to keep it
out of the plan file entirely (chat, a separate personal doc, or memory), which
loses the co-location with the plan it is about.

This is not a design yet, only the observation and the idea. Open questions:
whether such a section is a template header (like the existing gate sections:
*Could this be simpler?*, *NOT in scope*) or a separate sibling file; whether
an executing agent should skip it by convention or whether it needs enforcement
(a lint/doc-check rule); and whether this duplicates the closed
[work-summary-for-the-boxholder](../docs-and-chores/2026-08-12-work-summary-for-the-boxholder.md)
idea of a boxholder-facing summary at completion, or is a distinct need for
notes written *during* planning rather than at the end.

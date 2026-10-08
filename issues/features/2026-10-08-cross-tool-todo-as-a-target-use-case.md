---
title: "The cross-tool to-do (what I said I'd do, what was asked of me) as a target use case"
workstream: unattached
area: beebox
needs: [decision]
labels: [todos, connectors, competitive-research]
filed-by: agent
discovered-by: agent
discovered-in: worktree-imbue-studio-research — Studio's launch demo and task-inbox template
---

Imbue Studio's launch demo builds one thing: "turn your calendar, email and
Slack into a to-do list that updates in real time", with two sections, "I said
I'd do" and "Asked of me", each item linked to its source thread
([transcript](../../research/imbue-studio/sources.md)). Its task-inbox
template is the same shape: deterministic fetch from Slack and Gmail, an LLM
extraction pass with a fixed field spec (task, requester, due date and basis,
urgency and reason), deterministic assembly, bucketing by due date, three
refreshes a day, and no write-back
([research](../../research/imbue-studio/starter-templates.md)).

This is a candidate for the
[target-specific-use-cases decision](../decisions/2026-10-05-target-specific-underserved-use-cases.md)
that meets its criteria: real, served badly by inbox tools, and a fit for what
the box does. Bee Box's substrate is better for it than Studio's: todos are
tags in cards with `start`/`due`/`assigned` and one query path
(`beebox/docs/box/todos.md`); Gmail and Calendar already sync into cards and
write back; triage already turns inbound items into handled work; the result
sits beside every other record instead of in a per-app JSON store.

## What is missing

- **A Slack connector.** None exists. Studio reaches Slack through captured
  credentials; Bee Box would use a bot or user token in the secret store on
  the connector pattern (`beebox/docs/connectors.md`).
- **The extraction step as a procedure.** "Deterministic fetch, agent
  judgement, deterministic assemble" is the shape
  `beebox/docs/procedure-implementation.md` already describes; the judgement
  step writes `{% todo %}` tags with `by="agent"` and a `see-also` to the
  source message.
- **A live view.** A collection view over open todos grouped by plate
  (`bbx query todos --group plate` already exists) is the
  [collection-views](2026-08-19-collection-views-are-badly-defined.md)
  question with a concrete customer.
- **Pickup limits.** Agent-written todos need the bounded sweep in
  [agent-assigned todos](2026-09-24-agent-assigned-todos-have-no-pickup.md).

## Decision asked

Whether this is the first starter built under the use-case decision, ahead of
lending, inventory, meal planning, and scanned paper.

---
title: "Some todos are finished only by an answer, not by a tick"
workstream: unattached
area: beebox
needs: [design]
labels: [todos]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-todos-ui — boxholder direction while designing tickable todos
---

Some todos cannot be meaningfully "done" by a status change. "Find the phone
number" is finished when the phone number is written down. A tick without the
number records a completion that did not happen, and the result is lost.

The boxholder's idea (2026-09-24): "completion requires an answer" as a todo
property. The boxholder queued it and did not ask for it in the tickable-todos
work.

## What exists

- The todo-annotation design already sees this for agent work: an agent that
  closes its own todo adds a `{% see-also %}` to the evidence
  ([todo annotation](../../beebox/docs/implemented-plans/todo-annotation.md)).
  That is a convention in the agent guide, not a property of the todo.
- The [collection design notes](../../beebox/docs/plans/collections-design-notes.md)
  record that open questions are one kind of todo, and "when done, the text
  holds the answer". Where the answer goes is not defined.
- The questions subsystem (`beebox/docs/questions.md`) already models an
  item that closes with an answer.

## Open questions

- Whether this is an attribute on `{% todo %}`, or a kind the agent infers
  from the wording. The boxholder rejected a general `kind` attribute until
  something uses it in a structured way; this would be such a use.
- Where the answer is written: inside the todo body, after the closing tag,
  or into another card that the todo links to.
- What a tick control does for such a todo: open an answer field, or put the
  todo in chat so the boxholder can type the answer.
- Whether such a todo relates to a question card, or replaces one.

Related: [todos as inline things to think about](../features/2026-08-30-todos-inline-things-to-think-about.md).

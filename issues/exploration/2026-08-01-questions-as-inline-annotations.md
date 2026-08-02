---
title: "Retire the questions subsystem: make questions inline annotations in documents"
needs: [design]
area: callback-box
filed-by: agent
discovered-in: main session — boxholder riffing off ProofEditor's inline comment/question threads
labels: [soft-launch]
---

Replace the standalone questions subsystem with **questions embedded inline in
documents**, the same move that retired the todo-list schema in favor of the
inline `{% todo %}` annotation
([retire-todo-list-schema](../closed/features/2026-07-29-retire-todo-list-schema.md),
[todo-markdoc-annotation](../closed/features/2026-07-28-todo-markdoc-annotation.md)).
A question stops being a separate stored object. It becomes an annotation that
lives at the spot in a card it is about. The current subsystem
([questions-end-to-end](../../callback-box/docs/implemented-plans/questions-end-to-end.md))
would be retired.

## Where the idea comes from

ProofEditor (`proofeditor.ai`) shows a document with three things sharing one
interaction language, all anchored in the text: a suggested edit (strikethrough
old + inserted new), a comment/question thread (a human asks, the agent answers,
Reply / Resolve buttons), and provenance (per-block author bars, an agent
presence badge). The boxholder wants that thread model for questions: the
question sits at the exact content it concerns, and it is answered and resolved
in place.

## The core design decisions the boxholder has already made

- **The agent resolves.** The user may add to a thread, but the agent is the one
  that resolves the question. So the agent can do whatever is appropriate at
  resolution — including the **learning step**. This is how the old system's
  "every answer both acts and teaches" survives without the formal queue: the
  agent runs the promote-a-belief / update-the-guide work when it resolves, in
  code the agent controls, not as a separate `learning:` field on a queue entry.
- **Version control is the store.** The question and its resolution live in the
  card (and its history), so git is the durable record and audit trail. No
  separate questions store is needed for persistence.
- **Two placements, both attached to a card.** A question can sit **inline in the
  card body**, or in an **attachment at a conventional location** — e.g.
  `.attach/question.doc.card` — an out-of-band place for questions that is still
  attached to the card. This parallels how a `.doc.card` can carry todo lists.
  The out-of-band form keeps questions off the main body when the body should
  stay clean, without detaching them from their card.

## The open question this issue exists to settle

**Is this a use of `{% todo %}`, or a separate primitive?** Not yet decided.
- **Extend todo.** A question reads as "a todo whose resolution carries an answer
  and may teach." If the annotation machinery, rendering, and rollup are shared,
  a `{% question %}` may just be a todo kind. Extending todo is on the table.
- **Separate primitive.** A question has a thread (multiple messages), a resolver
  role (agent), and a learning side effect. A todo is binary / multi-state with
  no payload. That gap may justify its own tag.
- **Convergence frame.** `todo`, `question`, and `comment` may want to be one
  **anchored-annotation-with-thread family** — kinds of a single primitive —
  rather than three unrelated tags. ProofEditor presents them as one language.
  Design at that altitude before picking `{% question %}`-in-isolation.

## What must not be lost in the migration

- **The queue survives as a view, not a store.** The current subsystem's real
  strength is the prominent "N pending questions" indicator, visible on mobile
  where nav collapses. If questions scatter across many cards, the boxholder
  still needs one place to see every open one. So: inline annotations are the
  source of truth, and a **derived rollup** (every open question across the box)
  reconstitutes the queue as a view. Todos want the same rollup. Losing the
  aggregate is the regression to guard against.
- **It stays async.** The boxholder answers when they reach the doc. This does
  **not** reopen the in-chat-synchronicity objection that rejected interactive
  in-chat questions
  ([in-chat-interactive-questions was rejected](../../callback-box/docs/implemented-plans/questions-end-to-end.md)):
  that decision was about chat being synchronous. A question annotation in a
  document is still async. Reconcile this explicitly in the design so retiring
  the subsystem is a knowing choice, not an accidental reversal.

## Process notes for the design session

- Do a **Jobs-To-Be-Done pass first**: what does the boxholder actually need from
  a question — get unblocked, record a preference, teach the box, or just park an
  open thread? Decide the todo-vs-separate question from the jobs, not the syntax.
- This **deletes a shipped subsystem** built with settled decisions, so get a
  cross-model Codex review of the plan before it is called done.

## Related

- [questions-end-to-end](../../callback-box/docs/implemented-plans/questions-end-to-end.md)
  — the subsystem this would retire (its `learning:` / precedent goal is the part
  to preserve).
- [verify-todo-annotation-rendering](../features/2026-07-29-verify-todo-annotation-rendering.md)
  — the shipped inline-annotation machinery a question annotation would reuse.
- ProofEditor as an agent↔human doc-collaboration surface — the external
  inspiration; a separate exploration if the boxholder wants to track the tool
  itself.
</content>
</invoke>

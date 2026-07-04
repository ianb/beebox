---
needs: [design]
area: callback-box
---

# Questions, end-to-end (D1)

From the user-story audit (`docs/plans/user-story-audit-followups.md`, bucket D).
The removals, doc fixes, small fixes, and the calendar-conflict (D7) +
ref-normalization (D11) features all landed; these larger features were scoped
but not built. Parked here as the durable backlog (the audit plan doc and the
catalog's old `IAN:` annotations are transient).

The concrete answer-resolution bug is fixed (the form sent a synthesized letter
that the backend stored verbatim; it now sends the option label and
`src/core/commands/answer.ts` resolves the real id). But the maintainer flagged
the questions flow as generally under-baked ("probably a bunch of bugs; a feature
I want but haven't implemented well"). A focused pass — using the user-story
method on just the questions subsystem — would cover: confirm-type (yes/no)
questions rendering as a textarea instead of radios (`QuestionForm.tsx` falls
back to text when there's no `options` array); how triage creates questions and
the option-id scheme; and the answer schema round-trip. Medium.

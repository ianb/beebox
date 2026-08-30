---
title: "A ref that shares its object with other keys renders as dead text in the card view"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — following card-to-card links from a question card
---

In the frontmatter view of a card, a `ref` is linkified only when it is the whole
field value. A `ref` that sits in an object beside other keys renders as plain
text, so the link is not followable.

`isRef` requires an object with exactly one key
(`beebox/src/frontend/src/components/MarkdownCardView.tsx:48-53`):

```ts
if (Object.keys(value).length !== 1 || !("ref" in value)) return false;
```

Anything else falls through to `FieldsTable`, which renders each value as a
scalar.

Schemas define ref fields in exactly that shape. A question card's
`context: [{ref, text?}]` links to the related cards the question is about, and
`learning: {sink, ref?, proposal}` names the card the answer should be recorded
against (`beebox/src/schemas/question.ts:222`, `:246`, `:248`). Both render
as text today. Observed on question cards in the test1 clone; a whole-value ref
on the same page (`course.concept-map`) renders as a working control.

---
title: "Revisit: a structured card's front hides its facts in Properties"
workstream: unattached
needs: [decision]
area: beebox
labels: [frontend, properties, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending and D-chemistry journey walks, 2026-10-08
---

The [card-reading-properties design](../closed/features/2026-09-27-card-properties-design-session.md)
decided that a type with a body field shows its type fields in Properties,
not on the card front, because "the body is then what the card says". Two
walks show a cost of that rule for structured types.

- A-lending: a loan card has a body, so "with Bram · since around March ·
  unconfirmed" is only in Properties. The walker wanted those facts at the top
  of the item page. The same facts show on plate rows through the schema's
  `summarize` line, but not on the card front
  ([report](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), rows 37, 38, 78).
- D-chemistry: the agent told the person the progress page "lists each idea
  and what you've actually shown". The page has no such table, because the
  per-idea fields are in Properties
  ([report](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md), row 30).

This is the designed behavior, not a failed fix.

## Mechanism

`splitCardFields` puts every type field on the front only for a bodiless type,
an unknown schema, or embed mode
(`beebox/src/frontend/src/lib/card-field-faces.ts:50-56`).

## Decision needed

Options, none chosen:

1. Keep the rule. Teach schema authors (the box agent) to put facts the
   person needs into the body or the `summarize` line, and tell the agent
   what the page front shows.
2. Let a schema mark fields as `front`, so a structured type shows its key
   facts above the body.
3. Show the `summarize` line under the title for any card that defines one.

The D-chemistry walker's question, whether a progress table reads better as
a body section, belongs to the same decision. Related:
[Chat card embed puts every field before the body](../bugs/2026-10-08-chat-card-embed-puts-every-field-before-the-body.md),
[Course study home: last, next, uncertain](../features/2026-09-21-course-study-home-last-next-uncertain.md).

## Re-encounter 2026-10-09 (journey walks)

Seen again in three walks. [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (row 27): a loan's front is only the quoted sentence; person, dates and the flag sit behind Properties. The walker: "for thirty it's not a list I'd scan". [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 34): an inventory item shows only its title and "No body content". `record` has a `body` field, so `splitCardFields` sends every type field to Properties (`beebox/src/frontend/src/lib/card-field-faces.ts:50-56`) and the empty body renders "No body content" (`MarkdownCardView/CardBody.tsx:121`); the record schema itself advises "probably no body" for an inventory item (`beebox/src/schemas/record.tsx:124`), so following the schema guidance produces an empty front. [D2](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (row 32): a course progress page opened as one paragraph; its per-idea entries went to Properties, though the chat had said the page records the person's words for each rating. The walker's summary: "Half plumbing, half the thing I want".

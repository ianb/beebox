---
title: "Revisit: a structured card's front hides its facts in Properties"
workstream: unattached
area: beebox
labels: [frontend, properties, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending and D-chemistry journey walks, 2026-10-08
---

**Reopened 2026-10-22:** the fix covers only a card whose body is empty. A structured type whose body holds anything (a photo, a sentence) still hides its facts in Properties; see the re-encounter at the end.

**Closed (history):** Decided and implemented on branch worktree-place-shows-cards: a summary line sits under the title on card pages, and a bodied card with an empty body shows its fields on the front.

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
  ([report](../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-08.md), row 30).

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
[Chat card embed puts every field before the body](../closed/bugs/2026-10-08-chat-card-embed-puts-every-field-before-the-body.md),
[Course study home: last, next, uncertain](../features/2026-09-21-course-study-home-last-next-uncertain.md).

## Re-encounter 2026-10-09 (journey walks)

Seen again in three walks. [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (row 27): a loan's front is only the quoted sentence; person, dates and the flag sit behind Properties. The walker: "for thirty it's not a list I'd scan". [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 34): an inventory item shows only its title and "No body content". `record` has a `body` field, so `splitCardFields` sends every type field to Properties (`beebox/src/frontend/src/lib/card-field-faces.ts:50-56`) and the empty body renders "No body content" (`MarkdownCardView/CardBody.tsx:121`); the record schema itself advises "probably no body" for an inventory item (`beebox/src/schemas/record.tsx:124`), so following the schema guidance produces an empty front. [D2](../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-09-2.md) (row 32): a course progress page opened as one paragraph; its per-idea entries went to Properties, though the chat had said the page records the person's words for each rating. The walker's summary: "Half plumbing, half the thing I want".

## Reopened 2026-10-22 (B-inventory journey walk): the fix covers only an empty body

The 2026-10-09 fix put a summary line under the title and keeps type fields on the front when the body is empty. In the [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) walk (rows 18, 19, 46) the agent wrote a box-local `storage` type: one card per drawer, an `items` array of name, count, spot, and note, and a body that holds the drawer's two photos. The body is not empty, so `splitCardFields` sends `items` to Properties (`beebox/src/frontend/src/lib/card-field-faces.ts`). The drawer page showed the summary line ("workroom tray, drawer 1 · 24 kinds of things"), one sentence, two photos, and no item list. The walker: "No list of items, no counts, nothing I could read at a glance in the shop. ... This is the main worry." It found the list only by turning the card to Properties, under "Filed at", "Card type storage", and "Prominence".

The agent's own schema instructions told it to put the photos in the body, which makes the body non-empty on every card of the type. `beebox/box-docs/schemas.md` does not tell a schema author that type fields go to Properties when the body has content, so an author cannot design around the rule. Option 1 above (teach schema authors what the front shows) was not done, and options 2 and 3 do not cover an array field. The person's goal, to read a drawer's contents on the drawer's page, fails as it did on 2026-10-08.

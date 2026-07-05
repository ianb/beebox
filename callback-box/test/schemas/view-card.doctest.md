# View card schema

A `view` card makes an interface surface addressable: its `view` field names
a builtin view (src/shared/named-views.ts), which the frontend renders in
place of the card. See docs/plans/interface-as-cards.md ("instrument cards").

```ts setup
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";
import { ViewSchema } from "../../src/schemas/view.js";

const schemas = await createCardSchemaMap();
```

## A valid view card parses, with title and a notes body

The card is positional-or-nominal like any card; `title` is the label nav
refs fall back to, and the body is the notes margin for the surface.

```ts
const card = parseCardText(`---
title: Chats
view: chat-picker
---
The picker groups by landmark; watch whether the 7-day window feels right.
`, { source: "Chats.view.card", schemas });
card.fields["view"]
=> chat-picker

card.fields["title"]
=> Chats
```

## An unknown view name fails with the valid set enumerated

```ts
const tryParse = (text: string, source: string): string => {
  try { parseCardText(text, { source, schemas }); return "did not throw"; }
  catch (e) { return (e as Error).message; }
};
tryParse("---\nview: dashbord\n---\n", "Oops.view.card").includes("view must be one of: landmarks, chat-picker, questions, history")
=> true

tryParse("---\n---\n", "Empty.view.card").includes("view")
=> true
```

## `params` configure the view — validated against the view's declared shape

The self-contained `validate` hook (run by `cb validate`) checks `params`
against the named view's param schema. A `view: history` card with params
is a saved filter over the commit timeline.

```ts
const issues = (fields: Record<string, unknown>) =>
  (ViewSchema.validate?.({ fields }) ?? []).map((i) => i.message);

JSON.stringify(issues({ view: "history", params: { feedback: true, connectors: ["gmail"] } }))
=> []

JSON.stringify(issues({ view: "history", params: { feedbck: true } }))
=> ["params: Unrecognized key: \"feedbck\""]

JSON.stringify(issues({ view: "history", params: { feedback: "yes" } }))
=> ["params.feedback: Invalid input: expected boolean, received string"]

JSON.stringify(issues({ view: "landmarks", params: { anything: 1 } }))
=> ["view \"landmarks\" takes no params"]

JSON.stringify(issues({ view: "landmarks" }))
=> []
```

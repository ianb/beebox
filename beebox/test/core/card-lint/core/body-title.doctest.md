# A body that repeats the title warns

The card page shows the title from `title:`. A body that opens with the same
text as an H1 reads the title twice, so `lintCardsDispatch` warns on it. The
check uses `leadingTitleHeading` (`test/shared/leading-title-heading.doctest.md`),
the same predicate the card view uses to hide that line.

```ts setup
import { z } from "zod";
import { cardSchema, type CardSchema } from "../../../../src/cards/schema.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { lintCardsDispatch } from "../../../../src/core/card-lint/core/lint-cards.js";
import { DocSchema } from "../../../../src/schemas/doc.js";

// A type with a `title` and no body field.
const badgeSchema: CardSchema = cardSchema("badge", { fields: { title: z.string() } });
const ctx = { cardSchemas: new Map<string, CardSchema>([[DocSchema.type, DocSchema], ["badge", badgeSchema]]) };

/** The `body` warnings for one card file, as messages. */
async function bodyWarnings(name: string, text: string): Promise<string[]> {
  const box = await makeTmpBox();
  await box.write(`_content/${name}`, text);
  const result = await lintCardsDispatch([box.path(`_content/${name}`)], { boxRoot: box.root, ctx });
  await box.cleanup();
  return result.results[0]!.warnings.filter((w) => w.type === "body").map((w) => w.message);
}
```

```ts
await bodyWarnings("Trip.doc.card", "---\ntitle: Trip Report\n---\n# Trip report\n\nWe drove down on Friday.\n")
=> ["body repeats the title as a heading; the title is shown from `title:`"]
```

A body that opens with prose, or with a different heading, does not warn:

```ts
await bodyWarnings("Trip.doc.card", "---\ntitle: Trip Report\n---\nWe drove down on Friday.\n\n# Trip Report\n")
=> []

await bodyWarnings("Trip.doc.card", "---\ntitle: Trip Report\n---\n# Day one\n\nWe drove down on Friday.\n")
=> []
```

A card type without a body field is not checked, even when its file has text after the frontmatter:

```ts
await bodyWarnings("Gold.badge.card", "---\ntitle: Gold\n---\n# Gold\n")
=> []
```

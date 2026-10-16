# `card.get` returns the card's schema facts

The card faces need two facts from the card's schema: whether the type has a
body field (its type fields then go to Properties rather than the front) and
the type's default prominence (so Properties can say what an absent
`prominence:` means). `card.get` returns both as `schema`, or `null` when the
card did not parse against a schema.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

function caller(boxRoot: string) {
  const ctx: TrpcContext = trpcContext({ boxRoot, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}
```

A doc has a body field and is ordinary by default:

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/Plan.doc.card", "---\ntitle: Plan\n---\nThe plan.\n");
const doc = await caller(box.root).card.get({ path: "_content/Plan.doc.card" });
doc.schema
=> { hasBodyField: true, defaultProminence: "ordinary" }
```

A card whose frontmatter fails validation has no schema facts, so the front
shows all its fields:

```ts continue
await box.write("_content/Broken.doc.card", "---\ntitle: [not, a, title]\n---\nBody\n");
const broken = await caller(box.root).card.get({ path: "_content/Broken.doc.card" });
[broken.validationError === undefined, broken.schema]
=> [false, null]
```

```ts cleanup
await box.cleanup();
```

## `card.get` returns the type's summary line

`detail` is the line the card's type writes about itself (`summarize`), shown
under the title on the card page (docs/implemented-plans/place-shows-cards.md, Track B).
A record's line is where it is and how many; a doc writes none.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/Solder.record.card", "---\nname: Solder\nlocation:\n  text: Tray 3\nquantity:\n  value: 2 spools\n---\n");
await box.write("_content/Plan.doc.card", "---\ntitle: Plan\n---\nThe plan.\n");
const record = await caller(box.root).card.get({ path: "_content/Solder.record.card" });
const doc = await caller(box.root).card.get({ path: "_content/Plan.doc.card" });
[record.detail, "detail" in doc]
=> ["Tray 3 · 2 spools", false]
```

```ts cleanup
await box.cleanup();
```

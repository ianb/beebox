# `card.get` returns the card's schema facts

The card faces need two facts from the card's schema: whether the type has a
body field (its type fields then go to Properties rather than the front) and
the type's default prominence (so Properties can say what an absent
`prominence:` means). `card.get` returns both as `schema`, or `null` when the
card did not parse against a schema.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
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
await box.write("_content/Broken.memo.card", "---\nstatus: [not, a, status]\n---\nBody\n");
const broken = await caller(box.root).card.get({ path: "_content/Broken.memo.card" });
[broken.validationError === undefined, broken.schema]
=> [false, null]
```

```ts cleanup
await box.cleanup();
```

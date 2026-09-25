# `card.get` returns the body's line offset

A rendered todo is addressed by its line in the card's FILE, not in the body
the renderer is handed (`shared/todo-locators.ts`). `card.get` returns the
split body, so it also returns `bodyLineOffset`, the number of file lines
before that body, from the same `splitCardContent` the collector uses
(`docs/plans/todos-ui.md`, Track 2).

```ts setup
import Markdoc from "@markdoc/markdoc";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { assignLocators } from "../../src/shared/todo-locators.js";

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

A memo with a three-field frontmatter block: five lines precede the body.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/Porch.memo.card", [
  "---",
  "status: new",
  "created: 2026-07-01T10:00:00Z",
  "title: Porch",
  "---",
  "Intro line.",
  "",
  "{% todo %}Order lumber{% /todo %}",
  "",
].join("\n"));
box.commitAll("seed");

const card = await caller(box.root).card.get({ path: "_content/Porch.memo.card" });
card.bodyLineOffset
=> 5
```

Numbering the returned body with that offset gives the collector's locator:

```ts continue
JSON.stringify([...assignLocators(Markdoc.parse(card.body ?? ""), card.bodyLineOffset).values()])
=> [{"kind":"body","line":8}]

const res = await caller(box.root).collections.query({
  collection: "todos",
  query: { here: "_content/Porch.memo.card", includeReferring: false, params: { status: ["open"] } },
});
JSON.stringify(res.groups.flatMap((g) => g.rows.flatMap((r) => r.items.map((i) => i.locator))))
=> [{"kind":"body","line":8}]
```

A card whose frontmatter does not validate still reports the offset, since
its body is still shown:

```ts continue
await box.write("_content/Broken.memo.card", "---\nstatus: [not, a, status]\n---\nBody\n");
const broken = await caller(box.root).card.get({ path: "_content/Broken.memo.card" });
JSON.stringify([broken.validationError === undefined, broken.bodyLineOffset, broken.body])
=> [false,3,"Body\n"]
```

```ts cleanup
await box.cleanup();
```

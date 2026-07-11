# todos.updateItem

`todos.updateItem` toggles one item's status inside a `todo-list` card, then
commits the single file. The read-modify-write is wrapped in `withCardLock` so
two overlapping toggles on the same list can't drop one another's change
(`issues/closed/bugs/2026-07-04-webapp-mutation-concurrency.md`).

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getLog } from "../../src/lib/git.js";
import { simpleGit } from "simple-git";
import { parse as parseYaml } from "yaml";

// Full tRPC context; updateItem reads only ctx.boxRoot.
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

// Files touched by the newest commit (proves the commit's path scoping).
async function committedFiles(boxRoot) {
  const out = await simpleGit(boxRoot).raw(["show", "--name-only", "--format=", "HEAD"]);
  return out.trim();
}

// The items array parsed out of a todo-list card's frontmatter.
async function items(box, rel) {
  const text = await box.read(rel);
  const inner = text.replace(/^---\n/, "").replace(/\n---\n?$/, "");
  return parseYaml(inner).items;
}

const TODO = `---
name: Groceries
items:
  - name: Milk
    status: pending
  - name: Bread
    status: pending
---
`;
```

## Happy path: item flips to done, single file committed with trailers

Marking `Milk` done sets its status and stamps `completed` on *that* item only,
leaves `Bread` untouched, and records one commit scoped to just the list file —
with the `Source`/`Endpoint` trailers that attribute the write to the webapp. An
unrelated dirty file present in the tree is left out of the commit, proving the
commit is scoped to `paths` rather than a blanket `git add -A`.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/todos/Groceries.todo-list.card", TODO);
box.commitAll("seed");
// A decoy the mutation must NOT sweep into its commit.
await box.write("store/notes/decoy.md", "unrelated edit\n");

const res = await caller(box.root).todos.updateItem({
  listPath: "store/todos/Groceries.todo-list.card",
  itemName: "Milk",
  status: "done",
});
JSON.stringify(res)
=> {"success":true}
```

```ts continue
const [milk, bread] = await items(box, "store/todos/Groceries.todo-list.card");
// Milk is done and carries a completed timestamp; Bread is untouched and has none.
JSON.stringify([milk.name, milk.status, typeof milk.completed])
=> ["Milk","done","string"]

JSON.stringify([bread.name, bread.status, "completed" in bread])
=> ["Bread","pending",false]
```

```ts continue
const head = (await getLog(box.root, 1))[0];
head.subject
=> Update todo item "Milk" to done

JSON.stringify(head.trailers)
=> {"Source":"webapp","Endpoint":"todos.updateItem"}

// Only the list file was committed — the decoy stayed out.
await committedFiles(box.root)
=> store/todos/Groceries.todo-list.card
```

```ts continue
// The decoy is still an uncommitted, untracked working-tree file.
JSON.stringify((await simpleGit(box.root).status()).not_added)
=> ["store/notes/decoy.md"]
```

```ts cleanup
await box.cleanup();
```

## Failure paths: wrong type, missing file, missing item, bad status

A non-`todo-list` path is rejected before any read; a missing list is
`NOT_FOUND`; a name that isn't in the tree is `NOT_FOUND`; an out-of-enum status
is refused by Zod as `BAD_REQUEST`.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/todos/Groceries.todo-list.card", TODO);
box.commitAll("seed");
const c = caller(box.root);

async function code(p) {
  return p.then(() => "none", (e) => e.code);
}

// Path doesn't name a todo-list card.
await code(c.todos.updateItem({ listPath: "store/todos/x.memo.card", itemName: "Milk", status: "done" }))
=> BAD_REQUEST

// Todo-list card doesn't exist.
await code(c.todos.updateItem({ listPath: "store/todos/Nope.todo-list.card", itemName: "Milk", status: "done" }))
=> NOT_FOUND

// Item name not present in the list.
await code(c.todos.updateItem({ listPath: "store/todos/Groceries.todo-list.card", itemName: "Ghost", status: "done" }))
=> NOT_FOUND

// Status outside the enum — rejected by input validation.
await code(c.todos.updateItem({ listPath: "store/todos/Groceries.todo-list.card", itemName: "Milk", status: "frobnicate" }))
=> BAD_REQUEST
```

```ts continue
// None of the rejected calls mutated the card.
(await box.read("store/todos/Groceries.todo-list.card")).includes("status: done")
=> false
```

```ts cleanup
await box.cleanup();
```

## Concurrency: two overlapping toggles both land

Two updates to *different* items in the same list, launched together so their
read-modify-writes overlap. `withCardLock` serializes them, so both changes
compose — `Milk` ends `done` and `Bread` ends `cancelled`. Unlocked, both would
read the pre-mutation card and the last writer would drop the other's change
(the exact lost-update the closed issue described).

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/todos/Two.todo-list.card", TODO);
box.commitAll("seed");
const c = caller(box.root);

const [a, b] = await Promise.all([
  c.todos.updateItem({ listPath: "store/todos/Two.todo-list.card", itemName: "Milk", status: "done" }),
  c.todos.updateItem({ listPath: "store/todos/Two.todo-list.card", itemName: "Bread", status: "cancelled" }),
]);
JSON.stringify([a.success, b.success])
=> [true,true]
```

```ts continue
const card = await box.read("store/todos/Two.todo-list.card");
// Both updates survived — neither clobbered the other.
card.includes("name: Milk\n    status: done")
=> true

card.includes("name: Bread\n    status: cancelled")
=> true
```

```ts continue
// Each update committed its own change: two commits landed on top of the seed.
const subjects = (await getLog(box.root, 2)).map((l) => l.subject).sort();
JSON.stringify(subjects)
=> ["Update todo item \"Bread\" to cancelled","Update todo item \"Milk\" to done"]
```

```ts cleanup
await box.cleanup();
```

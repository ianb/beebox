# attach-lint: basename collisions and reserved names

`lintAttachLayout` walks a box tree enforcing two rules: no two cards in the
same directory may share a basename (case-insensitively — see below), and no
file/directory is literally named `attach` outside an existing
`<basename>.attach/` scope.

```ts setup
import { lintAttachLayout } from "../../src/lib/attach-lint.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Same-case basenames collide

```ts
const box = await makeTmpBox();
await box.write("Notes.memo.card", "---\nstatus: new\n---\n");
await box.write("Notes.todo-list.card", "---\nname: x\n---\n");
const errors = await lintAttachLayout(box.root);
JSON.stringify(errors.map((e) => e.path).toSorted())
=> ["Notes.memo.card","Notes.todo-list.card"]

errors[0]?.rule
=> basename-collision
```

```ts cleanup
await box.cleanup();
```

## Basenames that only differ by case also collide

macOS (and Windows) filesystems are case-insensitive, so `Foo.memo.card` and
`foo.memo.card` are the same path on disk even though a case-sensitive string
comparison would treat them as distinct basenames. The lint compares
case-insensitively so this is caught before it ever reaches disk.

```ts
const box2 = await makeTmpBox();
await box2.write("Foo.memo.card", "---\nstatus: new\n---\n");
await box2.write("foo.todo-list.card", "---\nname: x\n---\n");
const errors2 = await lintAttachLayout(box2.root);
JSON.stringify(errors2.map((e) => e.path).toSorted())
=> ["Foo.memo.card","foo.todo-list.card"]

errors2.every((e) => e.rule === "basename-collision")
=> true

errors2[0]?.message.includes("Foo")
=> true
```

```ts cleanup
await box2.cleanup();
```

## Different basenames (or different-case extensions) don't collide

The rule is already extension-insensitive by design (comparing basenames,
not full filenames) — this stays true alongside the new case-insensitivity.

```ts
const box3 = await makeTmpBox();
await box3.write("Alpha.memo.card", "---\nstatus: new\n---\n");
await box3.write("Beta.memo.card", "---\nstatus: new\n---\n");
const errors3 = await lintAttachLayout(box3.root);
errors3.length
=> 0
```

```ts cleanup
await box3.cleanup();
```

## The literal `attach` name is reserved outside an attach scope

```ts
const box4 = await makeTmpBox();
await box4.write("attach/placeholder.txt", "x");
const errors4 = await lintAttachLayout(box4.root);
JSON.stringify(errors4.map((e) => e.rule))
=> ["literal-attach-name"]
```

```ts cleanup
await box4.cleanup();
```

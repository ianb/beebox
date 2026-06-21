# cb view test

`cb view test <slug>` renders an agent-authored view in Node — in-process, no
server — and prints the output, or on failure the error with a source-mapped
stack. It loads the same cards the running app would pass the view.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PKG = process.cwd();

// Run the prebuilt CLI with the box as cwd (requireBoxRoot walks up from there).
function runViewTest(boxRoot, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PKG, "dist/cli.mjs"), "view", "test", ...args], { cwd: boxRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const MEMO_CARD = `---
status: new
created: 2026-03-01T12:00:00Z
---
Body
`;
```

## Happy path — renders real cards

A view that renders off its `cards` prop produces HTML and exits 0:

```ts
const box = await makeTmpBox();
await box.write("box/inbox/A.memo.card", MEMO_CARD);
await box.write("box/inbox/B.memo.card", MEMO_CARD);
await box.write("views/count.tsx", `
export const name = "Count";
export const dependencies = ["box/**/*.card"];
export const modes = ["page"];
export default function Count({ cards }) {
  return <div>{"cards: " + cards.length}</div>;
}
`);

const r = await runViewTest(box.root, ["count"]);
r.code
=> 0
```

```ts continue
r.stdout.includes("cards: 2")
=> true
```

```ts cleanup
await box.cleanup();
```

## Render failure — source-mapped stack

A view that throws during render exits 1 with the error and a stack that maps
back to the `.tsx` source (not the compiled output):

```ts
const box = await makeTmpBox();
await box.write("views/boom.tsx", `
export const name = "Boom";
export const dependencies = [];
export const modes = ["page"];
export default function Boom() {
  const items = undefined;
  return <ul>{items.map((x) => <li>{x}</li>)}</ul>;
}
`);

const r = await runViewTest(box.root, ["boom"]);
r.code
=> 1
```

```ts continue
r.stderr.includes("View render failed")
=> true
```

The stack names the view source file:

```ts continue
r.stderr.includes("views/boom.tsx")
=> true
```

```ts cleanup
await box.cleanup();
```

## Top-level (module-eval) failure — also source-mapped

A view that throws while the module evaluates (not in the component body) gets
the same source-mapped diagnostics — the import shares the render's error block:

```ts
const box = await makeTmpBox();
await box.write("views/topthrow.tsx", `
export const name = "TopThrow";
export const dependencies = [];
export const modes = ["page"];
const missing = undefined;
const boom = missing.value;
export default function TopThrow() { return <div>{boom}</div>; }
`);

const r = await runViewTest(box.root, ["topthrow"]);
r.code
=> 1
```

```ts continue
r.stderr.includes("View render failed")
=> true

r.stderr.includes("views/topthrow.tsx")
=> true
```

```ts cleanup
await box.cleanup();
```

## Async helper called during render throws

`fileUrl` is fine in render, but the async helpers (`readFile`, `writeFile`,
`adapterFetch`, …) throw a clear error if called during render — that's a view
bug v1 surfaces rather than silently returning empty:

```ts
const box = await makeTmpBox();
await box.write("views/early.tsx", `
export const name = "Early";
export const dependencies = [];
export const modes = ["page"];
export default function Early({ readFile, fileUrl }) {
  readFile("box/x.txt");
  return <img src={fileUrl("box/y.png")} />;
}
`);

const r = await runViewTest(box.root, ["early"]);
r.code
=> 1
```

```ts continue
r.stderr.includes("readFile() was called during render")
=> true
```

```ts cleanup
await box.cleanup();
```

## Nonexistent view

```ts
const box = await makeTmpBox();
const r = await runViewTest(box.root, ["ghost"]);
r.code
=> 1
```

```ts continue
r.stderr.includes("View not found: ghost")
=> true
```

```ts cleanup
await box.cleanup();
```

## --path warns when the card isn't selected

`--path` sets `params.path`; if the path isn't among the view's selected cards,
the command warns (but still renders):

```ts
const box = await makeTmpBox();
await box.write("views/page.tsx", `
export const name = "Page";
export const dependencies = ["store/**/*.card"];
export const modes = ["page"];
export default function Page({ params }) { return <div>{"path: " + (params.path || "none")}</div>; }
`);

const r = await runViewTest(box.root, ["page", "--path", "box/inbox/Nope.memo.card"]);
r.code
=> 0
```

```ts continue
r.stderr.includes("is not among")
=> true

r.stdout.includes("path: box/inbox/Nope.memo.card")
=> true
```

```ts cleanup
await box.cleanup();
```

## Invalid selected card — diagnostics and non-zero exit

When a dependency glob selects a card that fails to load, the command renders,
reports it, and exits non-zero unless `--allow-invalid-cards`:

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema\n");
await box.write("views/list.tsx", `
export const name = "List";
export const dependencies = ["box/**/*.card"];
export const modes = ["page"];
export default function List({ cards }) { return <div>n: {cards.length}</div>; }
`);

const r = await runViewTest(box.root, ["list"]);
r.code
=> 1
```

```ts continue
r.stderr.includes("Bad.bogus.card")
=> true
```

With the flag it exits 0:

```ts continue
const ok = await runViewTest(box.root, ["list", "--allow-invalid-cards"]);
ok.code
=> 0
```

```ts cleanup
await box.cleanup();
```

# `installTodoView` — the box-wide `todo-view` stock instance

`docs/implemented-plans/todo-annotation.md` Track 4 pins the box-wide plate as
**provisioned, not just templated**: `store/plate.todo-view.card`, explicit
`glob: "**"`, installed by `bbx init`'s stock-template pass
(`installTodoView`, `src/core/box/defaults.ts`) and tracked in
`config/template-versions.json` exactly like the other `installTemplateFile`-backed
stock cards (procedures, guides, personality, briefing, root landmark) —
same mechanism, same `fresh`/`unchanged` idempotence, no bespoke seeding path.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installTodoView } from "../../src/core/box/index.js";
import { isTemplateManagedPath } from "../../src/core/install-template-file.js";

async function makeBox() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-install-todo-view-"));
}

async function readVersions(box) {
  const text = await fs.readFile(path.join(box, "config/template-versions.json"), "utf-8");
  return JSON.parse(text);
}
```

## Fresh box: installs `store/plate.todo-view.card` with `glob: "**"`, and records it in the tracker

```ts
const box = await makeBox();
const installed = await installTodoView(box);
installed
=> true

const content = await fs.readFile(path.join(box, "store/plate.todo-view.card"), "utf-8");
content.includes('glob: "**"')
=> true
```

```ts continue
const versions = await readVersions(box);
Object.keys(versions)
=> [
  "store/plate.todo-view.card"
]
```

## Re-running on an already-installed, untouched box is a no-op (`installed: false`)

```ts continue
const installedAgain = await installTodoView(box);
installedAgain
=> false
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## `store/plate.todo-view.card` is a recognized template-managed path

So `bbx upgrade`/`syncTemplatesFromSource`'s selective commit step recognizes
its writes as generated output rather than unrelated dirt:

```ts
isTemplateManagedPath("store/plate.todo-view.card")
=> true

isTemplateManagedPath("store/other.todo-view.card")
=> false
```

# normalizeHistoryPath

The history filter takes a path, and the history UI displays paths in a
different form than the rest of the app uses. See
`src/webapp/trpc/routers/history.ts`.

Under the one-root layout (shapeVersion 3) the git root and the box root are
the same directory, but a box's git log can still carry pre-migration commits
from when it was a v2 package (git root one level above a nested `content/`
box root): `git log --name-status` reported `content/_config/foo.json` for
those commits, while every internal path boundary — `/api/files`, `card.get`,
`status.browse` — uses the box-relative `_config/foo.json`. Copying a path out
of the diff panel into the filter used to return an empty result, which reads
as "this file has no history" rather than "you gave me the other form".

This is a consume boundary, so it tolerates either form
(`src/shared/box-path.ts` states the rule).

```ts setup
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeHistoryPath } from "../../src/webapp/trpc/routers/history.js";

/** A box root laid out like a pre-migration v2 box: <box>/content, with git one level up. */
const box = mkdtempSync(path.join(tmpdir(), "history-path-"));
const boxRoot = path.join(box, "content");
mkdirSync(path.join(boxRoot, "_config"), { recursive: true });
writeFileSync(path.join(boxRoot, "_config", "template-versions.json"), "{}");
```

The box-relative form passes through untouched:

```ts
t.check(normalizeHistoryPath("_config/template-versions.json", boxRoot), "_config/template-versions.json");
```

The git-root-relative form the diff panel displays resolves to the same file:

```ts
t.check(normalizeHistoryPath("content/_config/template-versions.json", boxRoot), "_config/template-versions.json");
```

A path that names nothing is returned unchanged, so the caller's own validation
and the empty result still describe what was actually asked for:

```ts
t.check(normalizeHistoryPath("_config/nope.json", boxRoot), "_config/nope.json");
```

Stripping only happens when it *helps*. A box that genuinely contains its own
`content/` directory keeps that path, because the as-is form exists:

```ts continue
mkdirSync(path.join(boxRoot, "content"), { recursive: true });
writeFileSync(path.join(boxRoot, "content", "notes.md"), "hi");
t.check(normalizeHistoryPath("content/notes.md", boxRoot), "content/notes.md");
```

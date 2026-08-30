# `bbx attachments init-gitignore`: install and refresh the asset block

The asset block lists what git skips inside `.attach/` scopes (the bytes are
tracked by per-dir `manifest.json` instead). It is **managed**: adding an
extension to `ASSET_GITIGNORE_EXTENSIONS` has to reach boxes that were
initialized before it existed, or the newly-ignored type keeps getting committed
on exactly the longest-running boxes. So the command refreshes a stale block
rather than no-op'ing once the marker is present.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runInitGitignore, assetGitignorePatterns } from "../../../src/core/commands/attachments-gitignore.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const ctx = (boxRoot: string) => {
  const lines: string[] = [];
  return { lines, ctx: { boxRoot, write: () => {}, writeLine: (t: string) => lines.push(t) } };
};
const readIgnore = (root: string) => fs.readFile(path.join(root, ".gitignore"), "utf-8");
```

## Frozen web pages are ignored

The case this was added for: beebox-clerk writes a page snapshot to
`<card>.attach/page.frozen`, and without an entry git commits the bytes (one
real snapshot was 41MB).

```ts
assetGitignorePatterns().includes("**/*.attach/**/*.frozen")
=> true
```

## Installs into a box with no block

```ts
const box = await makeTmpBox();
await fs.writeFile(path.join(box.root, ".gitignore"), "node_modules/\n");
const a = ctx(box.root);
const res = await runInitGitignore(a.ctx);
JSON.stringify(res.data)
=> {"changed":true}

const after = await readIgnore(box.root);
after.startsWith("node_modules/\n")
=> true

after.includes("**/*.attach/**/*.frozen")
=> true
```

## Re-running when already current changes nothing

```ts continue
const b = ctx(box.root);
const res2 = await runInitGitignore(b.ctx);
JSON.stringify(res2.data)
=> {"changed":false}

b.lines[0]
=> Already up to date in .gitignore — no change.
```

## A stale block is refreshed in place

The regression this file exists for. A box carrying the pre-`frozen` list must
pick up the new entry — previously the marker alone made this a no-op.

```ts
const stale = await makeTmpBox();
await fs.writeFile(
  path.join(stale.root, ".gitignore"),
  "node_modules/\n\n# bbx-assets (managed by bbx attachments init-gitignore)\n**/*.attach/**/*.jpg\n**/*.attach/**/*.png\n",
);
const c = ctx(stale.root);
const res3 = await runInitGitignore(c.ctx);
JSON.stringify(res3.data)
=> {"changed":true}

c.lines[0]
=> Refreshed asset block in .gitignore.

const refreshed = await readIgnore(stale.root);
refreshed.includes("**/*.attach/**/*.frozen")
=> true
```

The block is replaced, not duplicated:

```ts continue
refreshed.split("# bbx-assets (managed by bbx attachments init-gitignore)").length - 1
=> 1
```

## Rules written after the block survive the refresh

The refresh must not swallow hand-written entries. Only comments and
`**/*.attach/**/*.` patterns count as block body, so anything else ends it.

```ts
const custom = await makeTmpBox();
await fs.writeFile(
  path.join(custom.root, ".gitignore"),
  "# bbx-assets (managed by bbx attachments init-gitignore)\n**/*.attach/**/*.jpg\n\nsecrets/\n*.local\n",
);
const d = ctx(custom.root);
await runInitGitignore(d.ctx);
const kept = await readIgnore(custom.root);
kept.includes("secrets/") && kept.includes("*.local")
=> true

kept.includes("**/*.attach/**/*.frozen")
=> true
```

## Creates `.gitignore` when the box has none

```ts
const bare = await makeTmpBox();
await fs.rm(path.join(bare.root, ".gitignore"), { force: true });
const e = ctx(bare.root);
const res4 = await runInitGitignore(e.ctx);
JSON.stringify(res4.data)
=> {"changed":true}

(await readIgnore(bare.root)).includes("**/*.attach/**/*.frozen")
=> true
```

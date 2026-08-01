# Box Initialization

`scaffoldV2Box` creates a shapeVersion-2 box: a package root (`package.json`,
`tsconfig.json`, `src/`) with the operational box nested at `content/`.
`initBox` creates the operational directory structure inside that content
root. `isValidBox` checks if a directory is a properly initialized box.
`findBoxRoot` walks up (and one level down, for a package root) to find the
box root.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isValidBox, getBoxMetadata, initBox } from "../../src/core/box/index.js";
import { scaffoldV2Box } from "../../src/core/box/package.js";
import { findBoxRoot, BOX_MARKER } from "../../src/lib/paths.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-doctest-"));
}

async function listDirs(root) {
  const result = [];
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        result.push(rel);
        await walk(path.join(dir, e.name), rel);
      }
    }
  }
  await walk(root, "");
  result.sort();
  return result.join("\n");
}
```

## Directory structure

A fresh v2 box's operational tree lives under `content/`. `.claude/` is not
here — it lives at the package root — but the operational directories are:

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldV2Box(tmp);
await listDirs(boxRoot)
=>
box
box/inbox
box/inbox/intake
box/inbox/staged
box/inbox/triaged
box/inbox/triaged/_unsure
box/inbox/unhandled
box/jobs
box/output
box/publish
box/questions
box/resources
config
config/connectors
config/procedures
config/schedules
config/schemas
people
places
store
store/archive
store/archive/done
store/archive/failed
store/archive/processed
store/calendar
store/chat
store/drive
store/recipes
store/reviews
store/reviews/retro
store/todos
store/trash
store/usage
tricks
tricks/lib
tricks/scripts
```

The box marker file contains version metadata:

```ts continue
const marker = JSON.parse(await fs.readFile(path.join(boxRoot, BOX_MARKER), "utf-8"));
marker.version
=> 1.0.0

marker.shapeVersion
=> 2
```

A properly initialized directory is recognized as a valid box:

```ts continue
await isValidBox(boxRoot)
=> true
```

## Validation

An empty directory is not a valid box:

```ts
const empty = await makeTmpDir();
await isValidBox(empty)
=> false
```

## Finding the box root

`findBoxRoot` walks up from any subdirectory to find the nearest box root
(the `content/` operational root):

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldV2Box(tmp);
const found = await findBoxRoot(path.join(boxRoot, "box", "inbox"));
found === boxRoot
=> true
```

## Finding a v2 box from its PACKAGE root

A v2 box's operational root is `<packageRoot>/content/` (marker at
`content/.cb-box`, not at the package root itself). `findBoxRoot` also
checks one level down: a directory with no `.cb-box` of its own, but a
`content/.cb-box` AND a `package.json` declaring a `callback-box`
dependency, resolves to `content/`.

```ts
const tmp = await makeTmpDir();
const { packageRoot, boxRoot } = await scaffoldV2Box(tmp);

const fromPackageRoot = await findBoxRoot(packageRoot);
fromPackageRoot === boxRoot
=> true
```

Running from inside `content/` itself, or a subdirectory of it, still resolves the same way (the `.cb-box` marker there is found first, before the downward check is even considered):

```ts continue
const fromContentRoot = await findBoxRoot(boxRoot);
const fromContentSubdir = await findBoxRoot(path.join(boxRoot, "box", "inbox"));
fromContentRoot === boxRoot && fromContentSubdir === boxRoot
=> true
```

An unrelated directory — no `.cb-box` anywhere upward, and no `content/.cb-box` + qualifying `package.json` at any level — fails closed with `null`, not a guess:

```ts continue
const unrelatedDir = await makeTmpDir();
await findBoxRoot(unrelatedDir)
=> null
```

A directory with a `content/.cb-box` but NO `package.json` declaring `callback-box` (e.g. an unrelated directory that just happens to contain a `content/` folder) is never mistaken for a package root:

```ts continue
const lookalikeRoot = await makeTmpDir();
const lookalikeContent = path.join(lookalikeRoot, "content");
await fs.mkdir(lookalikeContent, { recursive: true });
await fs.writeFile(path.join(lookalikeContent, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
await findBoxRoot(lookalikeRoot)
=> null
```

## Metadata and idempotent initialization

`getBoxMetadata` reads the marker file. Running `initBox` again preserves the original created timestamp:

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldV2Box(tmp);
const meta1 = await getBoxMetadata(boxRoot);
meta1.version
=> 1.0.0
```

```ts continue
await initBox(boxRoot, { skipGit: true });
const meta2 = await getBoxMetadata(boxRoot);
meta2.created === meta1.created
=> true

await isValidBox(boxRoot)
=> true
```

## Asset tracking: manifest scheme vs git-annex

`initBox` rewrites `.gitignore` and `.gitattributes` on every run, so it has to
know which asset-tracking scheme the box is on. A fresh box is on the manifest
scheme: asset bytes inside `.attach/` scopes are gitignored and tracked by
per-dir `manifest.json`, and Git LFS filters cover the same extensions.

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldV2Box(tmp);
const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
const gitattributes = await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8");
[
  gitignore.includes("**/*.attach/**/*.pdf"),
  gitignore.includes("managed by cb attachments init-gitignore"),
  gitattributes.includes("*.pdf filter=lfs") || gitattributes.includes("*.png filter=lfs"),
].join(" ")
=> true true true
```

Once `cb attachments to-annex` has converted the box, both of those forms are
wrong: assets must be *visible* to `git add` (that is how they reach the annex)
and the LFS filters are retired. `initBox` detects the conversion from
`.git/annex/` — the directory `git annex init` creates, which nothing this
function writes can affect — and emits the annex forms instead. Before the fix
this path silently de-annexed every converted box on its next `cb init`.

```ts continue
await fs.mkdir(path.join(tmp, ".git", "annex"), { recursive: true });
await initBox(boxRoot, { skipGit: true });
const annexIgnore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
const annexAttrs = await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8");
[
  annexIgnore.includes("**/*.attach/**/*.pdf"),
  annexIgnore.includes("managed by cb attachments unignore"),
  annexIgnore.includes("**/tmp-capture/**/*.attach/**"),
  annexAttrs.includes("filter=lfs"),
].join(" ")
=> false true true false
```

Capture staging stays ignored either way — a capture is pre-triage and gets
rewritten before it is filed.

And it is idempotent: a second `initBox` on the converted box leaves both files
byte-identical, so `cb init` no longer dirties the working tree of an annexed
box.

```ts continue
await initBox(boxRoot, { skipGit: true });
[
  (await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8")) === annexIgnore,
  (await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8")) === annexAttrs,
].join(" ")
=> true true
```

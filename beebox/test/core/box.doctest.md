# Box Initialization

`scaffoldBoxRoot` creates a shapeVersion-3 box: the npm-package half
(`package.json`, `tsconfig.json`, `src/`) and the operational half
(the underscore areas) both scaffolded at the ONE root. `initBox` creates the
operational directory structure at that root. `isValidBox` checks if a
directory is a properly initialized box. `findBoxRoot` walks up to find the
box root.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isValidBox, getBoxMetadata, initBox } from "../../src/core/box/index.js";
import { scaffoldBoxRoot } from "../../src/core/box/package.js";
import { findBoxRoot, BOX_MARKER } from "../../src/lib/paths.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-doctest-"));
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

A fresh v3 box's operational tree lives right at `boxRoot` (which is also
the npm-package root). We filter to just the operational (underscore) areas
here — `src/`, `.claude/`, `.beebox/`, and `node_modules/` are the code/agent
side, covered by their own doctests:

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldBoxRoot(tmp);
const allDirs = (await listDirs(boxRoot)).split("\n");
allDirs.filter((d) => d.startsWith("_")).join("\n")
=>
_bookkeeping
_bookkeeping/archive
_bookkeeping/archive/done
_bookkeeping/archive/failed
_bookkeeping/archive/processed
_bookkeeping/connectors
_bookkeeping/jobs
_bookkeeping/output
_bookkeeping/questions
_bookkeeping/resources
_bookkeeping/trash
_bookkeeping/usage
_config
_config/connectors
_config/procedures
_config/schedules
_config/schemas
_content
_content/calendar
_content/chat
_content/drive
_content/inbox
_content/inbox/intake
_content/inbox/staged
_content/inbox/triaged
_content/inbox/triaged/_unsure
_content/inbox/unhandled
_content/people
_content/places
_content/recipes
_content/reviews
_content/reviews/retro
_content/todos
_publish
_tmp
```

The box marker file contains version metadata:

```ts continue
const marker = JSON.parse(await fs.readFile(path.join(boxRoot, BOX_MARKER), "utf-8"));
marker.version
=> 1.0.0

marker.shapeVersion
=> 3
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

`findBoxRoot` walks up from any subdirectory to find the nearest box root:

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldBoxRoot(tmp);
const found = await findBoxRoot(path.join(boxRoot, "_content", "inbox"));
found === boxRoot
=> true
```

An unrelated directory — no `.beebox/box.json` anywhere upward — fails closed with `null`, not a guess:

```ts continue
const unrelatedDir = await makeTmpDir();
await findBoxRoot(unrelatedDir)
=> null
```

## Metadata and idempotent initialization

`getBoxMetadata` reads the marker file. Running `initBox` again preserves the original created timestamp:

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldBoxRoot(tmp);
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
per-dir `manifest.json`.

`.gitattributes` does *not* vary with the scheme. Git LFS is retired, so no box
gets `filter=lfs` rules — a manifest-scheme box gitignores its asset bytes, so
an LFS filter could never fire on it anyway, and carrying the rules only risked
re-LFS-ifying a converted box's new media if the annex probe below ever read
false.

```ts
const tmp = await makeTmpDir();
const { boxRoot } = await scaffoldBoxRoot(tmp);
const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
const gitattributes = await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8");
[
  gitignore.includes("**/*.attach/**/*.pdf"),
  gitignore.includes("managed by bbx attachments init-gitignore"),
  gitattributes.includes("filter=lfs"),
].join(" ")
=> true true false
```

Once `bbx attachments to-annex` has converted the box, the `.gitignore` form is
wrong: assets must be *visible* to `git add` (that is how they reach the annex).
`initBox` detects the conversion from `.git/annex/` — the directory `git annex
init` creates, which nothing this function writes can affect — and emits the
annex form instead. Before the fix this path silently de-annexed every converted
box on its next `bbx init`. `.gitattributes` is LFS-free either way.

```ts continue
await fs.mkdir(path.join(boxRoot, ".git", "annex"), { recursive: true });
await initBox(boxRoot, { skipGit: true });
const annexIgnore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
const annexAttrs = await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8");
[
  annexIgnore.includes("**/*.attach/**/*.pdf"),
  annexIgnore.includes("managed by bbx attachments unignore"),
  annexIgnore.includes("**/tmp-capture/**/*.attach/**"),
  annexAttrs.includes("filter=lfs"),
].join(" ")
=> false true true false
```

Capture staging stays ignored either way — a capture is pre-triage and gets
rewritten before it is filed.

And it is idempotent: a second `initBox` on the converted box leaves both files
byte-identical, so `bbx init` no longer dirties the working tree of an annexed
box.

```ts continue
await initBox(boxRoot, { skipGit: true });
[
  (await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8")) === annexIgnore,
  (await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8")) === annexAttrs,
].join(" ")
=> true true
```

```ts cleanup
await fs.rm(tmp, { recursive: true, force: true });
```

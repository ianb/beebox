# Map refresh precheck

Tests for `src/core/maps/precheck.ts` — the pure detection step that
identifies which `MAP.md` files need to be created or updated.

```ts setup
import { precheck } from "../src/core/maps/precheck.js";
import { saveMapState } from "../src/core/maps/state.js";
import { getHead } from "../src/cli/lib/git.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Skip reasons

A directory that isn't a git repo is skipped:

```
const box = await makeTmpBox();
const brief = await precheck({ boxRoot: box.root });
brief.needsWork
=> false

brief.skippedReason
=> not_a_repo
```

``` cleanup
await box.cleanup();
```

A repo with uncommitted work is skipped — we wait for tomorrow's run:

```
const box = await makeTmpBox({ git: true });
await box.write("scratch.txt", "wip");
const brief = await precheck({ boxRoot: box.root });
brief.skippedReason
=> uncommitted_work
```

``` cleanup
await box.cleanup();
```

## Bootstrap: no MAP.md anywhere yet

A clean box with no MAP.md files and no state — every directory is
reported as needing creation. The brief includes the current children so
the agent doesn't have to walk the tree itself.

A directory is mappable only when it has at least one visible
subdirectory (the "container rule"). File-only dirs are skipped — the
parent's MAP.md already lists them.

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");          // file-only dir (skipped)
await box.write("store/notes/a.md", "a");              // store has subdir → mapped
await box.write("store/archive/b.md", "b");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
print(`needsWork=${brief.needsWork}`);
print(`tasks=${brief.tasks.length}`);
const dirs = brief.tasks.map((t) => `${t.dir || "<root>"}:${t.action}`).toSorted();
print(dirs.join("\n"));
=>
needsWork=true
tasks=2
<root>:create
store:create
```

The root task lists every immediate child including the file-only ones:

``` continue
const root = brief.tasks.find((t) => t.dir === "")!;
print(root.children.join(", "));
=> inbox/, store/
```

``` cleanup
await box.cleanup();
```

## No-op: state matches HEAD

After we record state at HEAD, a re-run reports nothing to do:

```
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/foo.card", "<card/>");    // store has subdir → mapped
box.commitAll("seed");

await box.write("MAP.md", "");
await box.write("store/MAP.md", "");
box.commitAll("add maps");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

const brief = await precheck({ boxRoot: box.root });
print(`needsWork=${brief.needsWork}`);
print(`tasks=${brief.tasks.length}`);
=>
needsWork=false
tasks=0
```

``` cleanup
await box.cleanup();
```

## Add file: parent map dirties

A file added directly to a container dir invalidates that container's
MAP (its listing changes), not its parent's:

```
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/README.md", "top-level note");
box.commitAll("add README");

const brief = await precheck({ boxRoot: box.root });
const summary = brief.tasks.map((t) =>
  `${t.dir || "<root>"} added=[${t.added.join(",")}] deleted=[${t.deleted.join(",")}]`
);
print(summary.join("\n"));
=>
store added=[README.md] deleted=[]
```

``` cleanup
await box.cleanup();
```

## Modify-only: nothing dirties

Editing an existing file's contents doesn't change the listing, so no
MAP needs touching:

```
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/inbox/foo.card", "<card>updated</card>");
box.commitAll("edit foo");

const brief = await precheck({ boxRoot: box.root });
brief.needsWork
=> false
```

``` cleanup
await box.cleanup();
```

## New subdirectory: parent dirties, new dir gets mapped if container

A new subdirectory under a container dir shows up in the parent's
listing. If the new subdir has its own subdirs, it becomes mappable
too; if it's a leaf, only the parent dirties.

Leaf case — parent dirties, new dir is a leaf so it's not mapped:

```
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/triage/a.card", "<card/>");
box.commitAll("add triage");

const brief = await precheck({ boxRoot: box.root });
const summary = brief.tasks.map((t) =>
  `${t.dir || "<root>"}:${t.action} added=[${t.added.join(",")}]`
).toSorted();
print(summary.join("\n"));
=> store:update added=[triage/]
```

``` cleanup
await box.cleanup();
```

Container case — new dir has its own subdir, so it becomes mappable:

```
const box = await makeTmpBox({ git: true });
await box.write("store/inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/projects/proj-a/notes.md", "x");
box.commitAll("add nested project");

const brief = await precheck({ boxRoot: box.root });
const summary = brief.tasks.map((t) =>
  `${t.dir || "<root>"}:${t.action}`
).toSorted();
print(summary.join("\n"));
=>
store/projects:create
store:update
```

``` cleanup
await box.cleanup();
```

## Ignore patterns

Default patterns exclude `procedure/runs` and basenames matching
`thread-*` / `capture-*` / `scan-*` (per-item connector outputs):

```
const box = await makeTmpBox({ git: true });
await box.write("a/b/x.card", "x");
await box.write("procedure/runs/run-1/log.txt", "x");
await box.write("emails/thread-Foo/x.card", "x");
await box.write("emails/keep/sub/y.card", "x");
await box.write("inbox/capture-2026/audio.webm", "x");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
<root>
a
emails
emails/keep
```

Notes:
- `procedure/` has only `runs/` (excluded), so 0 visible subdirs — skipped.
- `emails/thread-Foo/` is hidden entirely (basename matches `**/thread-*`).
- `inbox/` has only `capture-2026/` (excluded), so 0 visible subdirs — skipped.

`emails/keep` is mapped because it has a subdir; `emails/keep/sub` is a
leaf and skipped under the container rule.

``` cleanup
await box.cleanup();
```

## User-supplied .cb-maps-ignore extends the defaults

```
const box = await makeTmpBox({ git: true });
await box.write("keep/sub/a.card", "x");
await box.write("dump/sub/b.card", "x");
await box.write(".cb-maps-ignore", "dump\n# comment line\n");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
<root>
keep
```

``` cleanup
await box.cleanup();
```

## path/* hides children but the dir itself stays visible

`store/items/*` excludes the per-item subdirs but keeps `store/items/`
itself in `store`'s listing — that's the "shell dir" pattern. Under the
container rule, `store/items` has 0 visible subdirs so it doesn't get
its own MAP.md; the parent's MAP describes it instead.

```
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: ["store/items/*"],
});
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
<root>
store
store/keep
```

`store`'s listing still includes `items/` so the agent can annotate it:

``` continue
const store = brief.tasks.find((t) => t.dir === "store")!;
print(store.children.join(", "));
=> items/, keep/
```

``` cleanup
await box.cleanup();
```

## path/** matches the prefix and all descendants

`store/items/**` hides `store/items` itself too — useful when the
collection is purely incidental and the parent shouldn't even mention it.

```
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: ["store/items/**"],
});
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
const store = brief.tasks.find((t) => t.dir === "store")!;
print(`store children: ${store.children.join(", ")}`);
=>
<root>
store
store/keep
store children: keep/
```

``` cleanup
await box.cleanup();
```

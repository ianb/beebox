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

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");
await box.write("store/notes/a.md", "a");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
print(`needsWork=${brief.needsWork}`);
print(`tasks=${brief.tasks.length}`);
const dirs = brief.tasks.map((t) => `${t.dir || "<root>"}:${t.action}`).toSorted();
print(dirs.join("\n"));
=>
needsWork=true
tasks=4
<root>:create
inbox:create
store/notes:create
store:create
```

The root task has the top-level children listed:

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
await box.write("inbox/foo.card", "<card/>");
box.commitAll("add foo");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "2026-05-04T00:00:00Z" },
      "inbox": { asOf: head, generatedAt: "2026-05-04T00:00:00Z" },
    },
  },
});

// MAP.md files have to exist too — otherwise it's a "create" task.
await box.write("MAP.md", "");
await box.write("inbox/MAP.md", "");
box.commitAll("add maps");

// Re-stamp state at the new HEAD (after the maps commit).
const head2 = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head2, generatedAt: "2026-05-04T00:00:00Z" },
      "inbox": { asOf: head2, generatedAt: "2026-05-04T00:00:00Z" },
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

## Add file: parent map dirties, others stay clean

Adding a new card to `inbox/` invalidates only the inbox MAP, not the
root MAP (since the inbox/ subdir was already there).

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("inbox/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "inbox": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("inbox/bar.card", "<card/>");
box.commitAll("add bar");

const brief = await precheck({ boxRoot: box.root });
const summary = brief.tasks.map((t) =>
  `${t.dir || "<root>"} added=[${t.added.join(",")}] deleted=[${t.deleted.join(",")}]`
);
print(summary.join("\n"));
=>
inbox added=[bar.card] deleted=[]
```

``` cleanup
await box.cleanup();
```

## Modify-only: nothing dirties

Editing an existing file's contents doesn't change the listing, so no
MAP needs touching:

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("inbox/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "inbox": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("inbox/foo.card", "<card>updated</card>");
box.commitAll("edit foo");

const brief = await precheck({ boxRoot: box.root });
brief.needsWork
=> false
```

``` cleanup
await box.cleanup();
```

## New subdirectory: parent dirties, new dir needs create

A new subdirectory under an existing one shows up in the parent's
listing (so parent dirties) and itself needs a MAP.md created:

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");
await box.write("MAP.md", "");
await box.write("inbox/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: head, generatedAt: "t" },
      "inbox": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("inbox/triage/a.card", "<card/>");
box.commitAll("add triage");

const brief = await precheck({ boxRoot: box.root });
const summary = brief.tasks.map((t) =>
  `${t.dir || "<root>"}:${t.action} added=[${t.added.join(",")}]`
).toSorted();
print(summary.join("\n"));
=>
inbox/triage:create added=[]
inbox:update added=[triage/]
```

``` cleanup
await box.cleanup();
```

## Ignore patterns

Default patterns exclude `procedure/runs` (entire subtree) and any
directory whose basename matches `thread-*`:

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");
await box.write("procedure/runs/run-2026-01-01/log.txt", "x");
await box.write("store/email/thread-Foo/a.card", "<card/>");
await box.write("store/email/thread-Foo/attachments/x.pdf", "x");
await box.write("store/email/regular-dir/y.card", "<card/>");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
<root>
inbox
procedure
store
store/email
store/email/regular-dir
```

`procedure/` itself is mapped, but `runs/` (matching the ignore pattern)
doesn't show up in its listing or descend into:

``` continue
const proc = brief.tasks.find((t) => t.dir === "procedure")!;
print(`procedure children: ${proc.children.join(", ") || "(none)"}`);
const email = brief.tasks.find((t) => t.dir === "store/email")!;
print(`store/email children: ${email.children.join(", ")}`);
=>
procedure children: (none)
store/email children: regular-dir/
```

``` cleanup
await box.cleanup();
```

## User-supplied .cb-maps-ignore extends the defaults

```
const box = await makeTmpBox({ git: true });
await box.write("keep/a.card", "<card/>");
await box.write("dump/b.card", "<card/>");
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

## path/* matches direct children only

`store/items/*` excludes the per-item subdirs (one level deeper) but
keeps `store/items/` itself mappable so its parent's listing still
points there:

```
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/items/c/deeper/x.md", "x");
await box.write("store/keep/note.md", "keep");
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
store/items
store/keep
```

``` cleanup
await box.cleanup();
```

## path/** matches the prefix and all descendants

```
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/note.md", "keep");
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: ["store/items/**"],
});
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
<root>
store
store/keep
```

``` cleanup
await box.cleanup();
```

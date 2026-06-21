# Map refresh precheck

Tests for `src/core/maps/precheck.ts` — the pure detection step that
identifies which `MAP.md` files need to be created or updated.

```ts setup
import { precheck } from "../../../src/core/maps/precheck.js";
import { saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/cli/lib/git.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## Skip reasons

A directory that isn't a git repo is skipped:

```ts
const box = await makeTmpBox();
const brief = await precheck({ boxRoot: box.root });
brief.needsWork
=> false

brief.skippedReason
=> not_a_repo
```

```ts cleanup
await box.cleanup();
```

A repo with uncommitted work is skipped — we wait for tomorrow's run:

```ts
const box = await makeTmpBox({ git: true });
await box.write("scratch.txt", "wip");
const brief = await precheck({ boxRoot: box.root });
brief.skippedReason
=> uncommitted_work
```

```ts cleanup
await box.cleanup();
```

But uncommitted state inside `procedure/runs/` is *not* counted —
the procedure engine intentionally writes "step is running" markers
there, and blanket-bailing would mean refresh-maps couldn't run
inside its own procedure step.

```ts
const box = await makeTmpBox({ git: true });
await box.write("a/b/note.md", "x");
await box.write("a/c.md", "y");
box.commitAll("seed");
await box.write("procedure/runs/refresh-maps_2026-05-09T2052/run.procedure-run.card",
                "<run-card status=\"running\"/>");

const brief = await precheck({ boxRoot: box.root });
print(`needsWork=${brief.needsWork}`);
print(`skipped=${brief.skippedReason ?? "(none)"}`);
=>
needsWork=true
skipped=(none)
```

```ts cleanup
await box.cleanup();
```

## Bootstrap: no MAP.md anywhere yet

A clean box with no MAP.md files and no state — every directory with
mappable contents is reported as needing creation. The brief includes the
current children so the agent doesn't have to walk the tree itself.

Rules that gate which directories qualify:
- **Container rule** — at least one visible subdirectory. File-only dirs
  are skipped (parent's MAP already lists them).
- **Useful-content rule** — at least 2 total visible children. A
  single-entry MAP just restates one bullet; not worth a file.
- **Root is always skipped** — top-level paths are skeleton categories
  already covered in CLAUDE.md.

```ts
const box = await makeTmpBox({ git: true });
await box.write("inbox/foo.card", "<card/>");          // file-only dir (skipped)
await box.write("store/notes/a.md", "a");              // store: 2 subdirs → mapped
await box.write("store/scratch/b.md", "b");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
print(`needsWork=${brief.needsWork}`);
print(`tasks=${brief.tasks.length}`);
const dirs = brief.tasks.map((t) => `${t.dir || "<root>"}:${t.action}`).toSorted();
print(dirs.join("\n"));
=>
needsWork=true
tasks=1
store:create
```

The store task lists every immediate child including the file-only ones:

```ts continue
const store = brief.tasks.find((t) => t.dir === "store")!;
print(store.children.join(", "));
=> notes/, scratch/
```

```ts cleanup
await box.cleanup();
```

## No-op: state matches HEAD

After we record state at HEAD, a re-run reports nothing to do:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
box.commitAll("seed");

await box.write("store/MAP.md", "");
box.commitAll("add maps");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
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

```ts cleanup
await box.cleanup();
```

## Add file: parent map dirties

A file added directly to a container dir invalidates that container's
MAP (its listing changes), not its parent's:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
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

```ts cleanup
await box.cleanup();
```

## Modify-only: nothing dirties

Editing an existing file's contents doesn't change the listing, so no
MAP needs touching:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/notes/a.md", "updated");
box.commitAll("edit a");

const brief = await precheck({ boxRoot: box.root });
brief.needsWork
=> false
```

```ts cleanup
await box.cleanup();
```

## New subdirectory: parent dirties, new dir gets mapped if container

A new subdirectory under a container dir shows up in the parent's
listing. If the new subdir has its own subdirs, it becomes mappable
too; if it's a leaf, only the parent dirties.

Leaf case — parent dirties, new dir is a leaf so it's not mapped:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
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

```ts cleanup
await box.cleanup();
```

Container case — new dir has its own subdir + file (≥2 children), so it
becomes mappable:

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "store": { asOf: head, generatedAt: "t" },
    },
  },
});

await box.write("store/projects/proj-a/notes.md", "x");
await box.write("store/projects/README.md", "y");
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

```ts cleanup
await box.cleanup();
```

## Ignore patterns

Default patterns include the skeleton hide-list (`procedure/**`,
`box/inbox/**`, `store/archive/**`, etc.) and any directory ending in
`.attach` (card attach scopes are an implementation detail of the card
layout):

```ts
const box = await makeTmpBox({ git: true });
await box.write("a/b/x.card", "x");
await box.write("a/c/y.card", "x");  // 2 subdirs for `a` to qualify
await box.write("procedure/runs/run-1/log.txt", "x");
await box.write("emails/Foo.attach/x.card", "x");
await box.write("emails/keep/sub/y.card", "x");
await box.write("emails/keep/sub2/z.card", "x");  // 2 subdirs for `emails/keep` to qualify
await box.write("emails/index.md", "x");  // 2nd visible child for `emails` to qualify
await box.write("box/inbox/capture-1.attach/audio.webm", "x");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
a
emails
emails/keep
```

Notes:
- Root is always skipped (every top-level dir is skeleton).
- `procedure/**` hides the whole `procedure/` tree.
- `emails/Foo.attach/` is hidden (matches `**/*.attach`).
- `box/inbox/**` hides the whole inbox tree (skeleton, high churn).

`emails/keep` is mapped because it has two subdirs; `emails/keep/sub` is
a leaf and skipped under the container rule.

```ts cleanup
await box.cleanup();
```

## User-supplied .cb-maps-ignore extends the defaults

```ts
const box = await makeTmpBox({ git: true });
await box.write("keep/sub/a.card", "x");
await box.write("keep/sub2/c.card", "x");
await box.write("dump/sub/b.card", "x");
await box.write(".cb-maps-ignore", "dump\n# comment line\n");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
keep
```

```ts cleanup
await box.cleanup();
```

## Single-entry MAPs are skipped

A directory with one visible subdir and nothing else doesn't qualify
for a MAP — the single bullet would just restate the dirname.

```ts
const box = await makeTmpBox({ git: true });
await box.write("collection/only-child/a.md", "x");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.length === 0 ? "(none)" : dirs.join("\n"));
=> (none)
```

Add a sibling file and the dir qualifies:

```ts continue
await box.write("collection/notes.md", "y");
box.commitAll("add sibling file");
const brief2 = await precheck({ boxRoot: box.root });
const dirs2 = brief2.tasks.map((t) => t.dir).toSorted();
print(dirs2.join("\n"));
=> collection
```

```ts cleanup
await box.cleanup();
```

## path/* hides children but the dir itself stays visible

`store/items/*` excludes the per-item subdirs but keeps `store/items/`
itself in `store`'s listing — that's the "shell dir" pattern. Under the
container rule, `store/items` has 0 visible subdirs so it doesn't get
its own MAP.md; the parent's MAP describes it instead.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
await box.write("store/keep/sub2/y.md", "y");
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: ["store/items/*"],
});
const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
print(dirs.join("\n"));
=>
store
store/keep
```

`store`'s listing still includes `items/` so the agent can annotate it:

```ts continue
const store = brief.tasks.find((t) => t.dir === "store")!;
print(store.children.join(", "));
=> items/, keep/
```

```ts cleanup
await box.cleanup();
```

## path/** matches the prefix and all descendants

`store/items/**` hides `store/items` itself too — useful when the
collection is purely incidental and the parent shouldn't even mention it.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
await box.write("store/keep/sub2/y.md", "y");
await box.write("store/README.md", "z");  // 2nd visible child for store
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
store
store/keep
store children: README.md, keep/
```

```ts cleanup
await box.cleanup();
```

# Map refresh precheck

Tests for `src/core/maps/precheck.ts` — the pure detection step that
identifies which `MAP.md` files need to be created or updated.

```ts setup
import { precheck } from "../../../src/core/maps/precheck.js";
import { saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_IGNORE_PATTERNS, SKELETON_HIDDEN_PATHS } from "../../../src/core/maps/precheck-ignore.js";

/**
 * A fresh shapeVersion-3 box already has `_bookkeeping/`, `_content/`, and
 * `src/` scaffolded with enough visible (non-skeleton-hidden) children —
 * `_bookkeeping/usage`, `_bookkeeping/connectors`, `_content/recipes`,
 * `_content/todos`, etc. — to qualify for their own MAP.md under the
 * container + useful-content rules. None of these tests are about that
 * always-present baseline, so this seeds and records MAP.md for all three
 * up front — they never change afterward (tests only write into their own
 * custom top-level dirs), so recording them once at the seed commit keeps
 * them permanently quiet (the diff, not an exact HEAD match, decides
 * dirtiness). Returns the recorded entries so a test that calls
 * `saveMapState` again later can spread them back in (`saveMapState`
 * replaces the whole file, it doesn't merge).
 */
async function seedSkeletonMaps(box) {
  for (const dir of ["_bookkeeping", "_content", "src"]) {
    await box.write(`${dir}/MAP.md`, "");
  }
  box.commitAll("seed skeleton maps");
  const head = await getHead(box.root);
  const entries = {
    "_bookkeeping": { asOf: head, generatedAt: "t" },
    "_content": { asOf: head, generatedAt: "t" },
    "src": { asOf: head, generatedAt: "t" },
  };
  await saveMapState({ boxRoot: box.root, state: { maps: entries } });
  return entries;
}
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

But uncommitted state inside `_bookkeeping/procedure/runs/` is *not* counted —
the procedure engine intentionally writes "step is running" markers
there, and blanket-bailing would mean refresh-maps couldn't run
inside its own procedure step.

```ts
const box = await makeTmpBox({ git: true });
await box.write("a/b/note.md", "x");
await box.write("a/c.md", "y");
box.commitAll("seed");
await box.write("_bookkeeping/procedure/runs/refresh-maps_2026-05-09T2052/run.procedure-run.card",
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
await seedSkeletonMaps(box);
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
const skeleton = await seedSkeletonMaps(box);
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
      ...skeleton,
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
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      ...skeleton,
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
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      ...skeleton,
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
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      ...skeleton,
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
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a");
await box.write("store/scratch/b.md", "b");
await box.write("store/MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      ...skeleton,
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

Default patterns include the skeleton hide-list (`_bookkeeping/procedure/runs/**`,
`_content/inbox/**`, `_bookkeeping/archive/**`, etc.) and any directory
ending in `.attach` (card attach scopes are an implementation detail of
the card layout):

```ts
const box = await makeTmpBox({ git: true });
await seedSkeletonMaps(box);
await box.write("a/b/x.card", "x");
await box.write("a/c/y.card", "x");  // 2 subdirs for `a` to qualify
await box.write("_bookkeeping/procedure/runs/run-1/log.txt", "x");
await box.write("emails/Foo.attach/x.card", "x");
await box.write("emails/keep/sub/y.card", "x");
await box.write("emails/keep/sub2/z.card", "x");  // 2 subdirs for `emails/keep` to qualify
await box.write("emails/index.md", "x");  // 2nd visible child for `emails` to qualify
await box.write("_content/inbox/capture-1.attach/audio.webm", "x");
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
- `_bookkeeping/procedure/runs/**` hides the whole `_bookkeeping/procedure/runs/` tree.
- `emails/Foo.attach/` is hidden (matches `**/*.attach`).
- `_content/inbox/**` hides the whole inbox tree (skeleton, high churn).

`emails/keep` is mapped because it has two subdirs; `emails/keep/sub` is
a leaf and skipped under the container rule.

```ts cleanup
await box.cleanup();
```

## Instruction files and box config never appear in a listing

Every box gets an `AGENTS.md` symlink beside each `CLAUDE.md` so a Codex
session finds the same content under the name it reads. Both names are meta —
listing either one asks the agent to describe an instruction file in a content
MAP, which it correctly refuses to do, so the precheck never goes quiet and
every later run fails the same way. `_config/box.json` is machine-owned config
the admin UI rewrites, and is hidden for the same reason.

The mirror is a real symlink (git mode 120000), so this seeds one rather than a
regular file: `readdir` reports it via `isDirectory() === false` and `ls-tree`
as a blob, and the fix has to hold on both paths.

```ts
const box = await makeTmpBox({ git: true });
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a\n");
await box.write("store/refs/b.md", "b\n");
await box.write("store/CLAUDE.md", "@MAP.md\n");
await symlink("CLAUDE.md", join(box.root, "store", "AGENTS.md"));
await box.write("_config/a/x.md", "x");
await box.write("_config/b/y.md", "y");
box.commitAll("seed");

const brief = await precheck({ boxRoot: box.root });
const children = (dir: string) => brief.tasks.find((t) => t.dir === dir)?.children.join(", ") ?? "(no task)";
print(`store: ${children("store")}`);
print(`_config: ${children("_config")}`);
=>
store: notes/, refs/
_config: a/, b/, migrations.jsonl, template-versions.json, transcription.json
```

The git-side listing agrees. This half has to be set up so the mirror appears
*between* the recorded state and HEAD — `listChildrenAtCommit` compares only the
immediate children of the mapped directory, so planting the symlink anywhere
else, or before the state is stamped, asserts nothing:

```ts continue
await box.write("people/ann/a.md", "a\n");
await box.write("people/bob/b.md", "b\n");
await box.write("people/MAP.md", "# Map: people\n");
box.commitAll("people, no instruction files yet");
await saveMapState({
  boxRoot: box.root,
  state: { maps: { ...skeleton, people: { asOf: await getHead(box.root), generatedAt: "t" } } },
});

const peopleTask = async () => {
  const task = (await precheck({ boxRoot: box.root })).tasks.find((t) => t.dir === "people");
  return task === undefined ? "(none)" : `${task.action}:${task.added.join("|")}`;
};

await box.write("people/CLAUDE.md", "@MAP.md\n");
await symlink("CLAUDE.md", join(box.root, "people", "AGENTS.md"));
box.commitAll("plant instruction files");
print(`after instruction files: ${await peopleTask()}`);

await box.write("people/real.md", "r\n");
box.commitAll("real file");
print(`after real file: ${await peopleTask()}`);
=>
after instruction files: (none)
after real file: update:real.md
```

```ts cleanup
await box.cleanup();
```

## User-supplied .bbx-maps-ignore extends the defaults

```ts
const box = await makeTmpBox({ git: true });
await seedSkeletonMaps(box);
await box.write("keep/sub/a.card", "x");
await box.write("keep/sub2/c.card", "x");
await box.write("dump/sub/b.card", "x");
await box.write(".bbx-maps-ignore", "dump\n# comment line\n");
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
await seedSkeletonMaps(box);
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
await seedSkeletonMaps(box);
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
await box.write("store/keep/sub2/y.md", "y");
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: [...DEFAULT_IGNORE_PATTERNS, ...SKELETON_HIDDEN_PATHS, "store/items/*"],
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
await seedSkeletonMaps(box);
await box.write("store/items/a/note.md", "a");
await box.write("store/items/b/note.md", "b");
await box.write("store/keep/sub/x.md", "x");
await box.write("store/keep/sub2/y.md", "y");
await box.write("store/README.md", "z");  // 2nd visible child for store
box.commitAll("seed");

const brief = await precheck({
  boxRoot: box.root,
  ignorePatterns: [...DEFAULT_IGNORE_PATTERNS, ...SKELETON_HIDDEN_PATHS, "store/items/**"],
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

## An unresolvable asOf is an anomaly, not a diff

When the commit a MAP.md was generated against no longer resolves — history
rewritten, objects GC'd, a shallow clone — there is no trustworthy prior
listing. Diffing against it would report every current child as newly added.
The precheck records an anomaly and downgrades the task to `create`, so the
map is regenerated from what's actually on disk.

```ts
const box = await makeTmpBox({ git: true });
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a\n");
await box.write("store/refs/b.md", "b\n");
await box.write("store/MAP.md", "# Map: store\n");
box.commitAll("seed");

await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      ...skeleton,
      store: { asOf: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", generatedAt: "t" },
    },
  },
});
box.commitAll("state");

const brief = await precheck({ boxRoot: box.root });
print(JSON.stringify(brief.anomalies));
print(brief.tasks.map((t) => `${t.dir}:${t.action}:+${t.added.length}`).join(" "));
=>
[{"kind":"asof_unresolvable","dir":"store","asOf":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}]
store:create:+0
```

```ts cleanup
await box.cleanup();
```

## A directory absent at a *resolvable* asOf is ordinary

The anomaly must not over-fire. A dir that simply didn't exist yet at `asOf`
has an honest empty prior listing, so its children really are additions — that
is a normal `update`, with no anomaly.

```ts
const box = await makeTmpBox({ git: true });
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a\n");
await box.write("store/refs/b.md", "b\n");
await box.write("store/MAP.md", "# Map: store\n");
box.commitAll("seed");
const asOf = await getHead(box.root);

await box.write("store/later/c.md", "c\n");
box.commitAll("add store/later");

await saveMapState({
  boxRoot: box.root,
  state: { maps: { ...skeleton, store: { asOf, generatedAt: "t" } } },
});
box.commitAll("state");

const brief = await precheck({ boxRoot: box.root });
print(`anomalies: ${brief.anomalies.length}`);
print(brief.tasks.map((t) => `${t.dir}:${t.action}:${t.added.join("|")}`).join(" "));
=>
anomalies: 0
store:update:later/
```

```ts cleanup
await box.cleanup();
```

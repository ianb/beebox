# Map refresh precheck

Tests for `src/core/maps/precheck.ts` — the pure detection step that
identifies which `MAP.md` files need to be created or updated.

```ts setup
import { precheck } from "../../../src/core/maps/precheck.js";
import { saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git/core/operations.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_IGNORE_PATTERNS, SKELETON_HIDDEN_PATHS } from "../../../src/core/maps/precheck-ignore.js";

/**
 * A fresh shapeVersion-3 box already has `_bookkeeping/`, `_config/`, `_content/`, and
 * `src/` scaffolded with enough visible (non-skeleton-hidden) children —
 * `_bookkeeping/usage`, `_bookkeeping/connectors`, `_content/recipes`,
 * `_content/todos`, etc. — to qualify for their own MAP.md under the
 * container + useful-content rules. None of these tests are about that
 * always-present baseline, so this seeds and records MAP.md for all four
 * up front — they never change afterward (tests only write into their own
 * custom top-level dirs), so recording them once at the seed commit keeps
 * them permanently quiet (the diff, not an exact HEAD match, decides
 * dirtiness). Returns the recorded entries so a test that calls
 * `saveMapState` again later can spread them back in (`saveMapState`
 * replaces the whole file, it doesn't merge).
 */
async function seedSkeletonMaps(box) {
  for (const dir of ["_bookkeeping", "_config", "_content", "src"]) {
    await box.write(`${dir}/MAP.md`, "");
  }
  box.commitAll("seed skeleton maps");
  const head = await getHead(box.root);
  const entries = {
    "_bookkeeping": { asOf: head, generatedAt: "t" },
    "_config": { asOf: head, generatedAt: "t" },
    "_content": { asOf: head, generatedAt: "t" },
    "src": { asOf: head, generatedAt: "t" },
  };
  await saveMapState({ boxRoot: box.root, state: { maps: entries } });
  return entries;
}

/**
 * `store/` holds two subdirs and a MAP.md, and the recorded state matches
 * HEAD, so nothing is dirty until a test changes something.
 */
async function cleanStoreBox() {
  const box = await makeTmpBox({ git: true });
  const skeleton = await seedSkeletonMaps(box);
  await box.write("store/notes/a.md", "a");
  await box.write("store/scratch/b.md", "b");
  await box.write("store/MAP.md", "");
  box.commitAll("seed");
  const head = await getHead(box.root);
  await saveMapState({
    boxRoot: box.root,
    state: { maps: { ...skeleton, "store": { asOf: head, generatedAt: "t" } } },
  });
  return box;
}

function taskLine(t) {
  return `${t.dir || "<root>"}:${t.action} added=[${t.added.join(",")}] deleted=[${t.deleted.join(",")}]`;
}
```

## Skip reasons

A directory that isn't a git repo is skipped:

```ts
const box = await makeTmpBox({ git: "none" });
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

Two kinds of uncommitted state are not user work, so they do not skip the run:

- `_bookkeeping/procedure/runs/`: the procedure engine intentionally writes
  "step is running" markers there, and blanket-bailing would mean
  refresh-maps couldn't run inside its own procedure step.
- `_bookkeeping/usage/session-manifest.jsonl`: the refresh agent's own session
  appends to it before its first tool call. Without this exception the agent's
  `bbx refresh-maps --brief` always returned no tasks.

```ts
const exempt: Array<[string, string, string]> = [
  ["procedure run marker", "_bookkeeping/procedure/runs/refresh-maps_2026-05-09T2052/run.procedure-run.card", "<run-card status=\"running\"/>"],
  ["usage session manifest", "_bookkeeping/usage/session-manifest.jsonl", "{}\n{}\n"],
];
const out: string[] = [];
for (const [label, path, content] of exempt) {
  const box = await makeTmpBox({ git: true });
  await box.write("a/b/note.md", "x");
  await box.write("a/c.md", "y");
  await box.write("_bookkeeping/usage/session-manifest.jsonl", "{}\n");
  box.commitAll("seed");
  await box.write(path, content);

  const brief = await precheck({ boxRoot: box.root });
  out.push(`${label}: needsWork=${brief.needsWork} skipped=${brief.skippedReason ?? "(none)"}`);
  await box.cleanup();
}

out.join("\n")
=>
procedure run marker: needsWork=true skipped=(none)
usage session manifest: needsWork=true skipped=(none)
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
// The store task lists every immediate child, including file-only ones.
print(brief.tasks.find((t) => t.dir === "store")!.children.join(", "));
=>
needsWork=true
tasks=1
store:create
notes/, scratch/
```

```ts cleanup
await box.cleanup();
```

## What dirties a map

Recorded state at HEAD means a re-run reports nothing to do. After that, only a
change to a directory's *listing* dirties its map:

- A file added directly to a container dir invalidates that container's MAP,
  not its parent's.
- Editing an existing file's contents doesn't change the listing, so no MAP
  needs touching.
- A new leaf subdirectory dirties the parent only; the leaf is not mapped.
- A new subdirectory with its own subdir and a file (at least 2 children)
  becomes mappable too.

Each case starts from a fresh `store/` whose state matches HEAD:

```ts
const cases: Array<[string, null | ((box) => Promise<void>)]> = [
  ["no change", null],
  ["add file", async (box) => { await box.write("store/README.md", "top-level note"); }],
  ["modify file", async (box) => { await box.write("store/notes/a.md", "updated"); }],
  ["new leaf dir", async (box) => { await box.write("store/triage/a.card", "<card/>"); }],
  ["new container dir", async (box) => {
    await box.write("store/projects/proj-a/notes.md", "x");
    await box.write("store/projects/README.md", "y");
  }],
];
const out: string[] = [];
for (const [label, change] of cases) {
  const box = await cleanStoreBox();
  if (change) {
    await change(box);
    box.commitAll(label);
  }
  const brief = await precheck({ boxRoot: box.root });
  out.push(`${label}: needsWork=${brief.needsWork} ${brief.tasks.map(taskLine).toSorted().join(" | ") || "(no tasks)"}`);
  await box.cleanup();
}

out.join("\n")
=>
no change: needsWork=false (no tasks)
add file: needsWork=true store:update added=[README.md] deleted=[]
modify file: needsWork=false (no tasks)
new leaf dir: needsWork=true store:update added=[triage/] deleted=[]
new container dir: needsWork=true store/projects:create added=[] deleted=[] | store:update added=[projects/] deleted=[]
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
_config: a/, b/, feedback/, interface/, migrations.jsonl, template-versions.json, transcription.json
```

The git-side listing agrees. This half has to be set up so the mirror appears
*between* the recorded state and HEAD — the diff compares only the
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

## path/* and path/** in the ignore list

`store/items/*` excludes the per-item subdirs but keeps `store/items/`
itself in `store`'s listing — that's the "shell dir" pattern. Under the
container rule, `store/items` has 0 visible subdirs so it doesn't get
its own MAP.md; the parent's MAP describes it instead, and the agent can
annotate `items/`.

`store/items/**` hides `store/items` itself too — useful when the
collection is purely incidental and the parent shouldn't even mention it.

```ts
const patterns: Array<[string, string[]]> = [
  ["store/items/*", []],
  ["store/items/**", ["store/README.md"]],  // 2nd visible child for store
];
const out: string[] = [];
for (const [pattern, extraFiles] of patterns) {
  const box = await makeTmpBox({ git: true });
  await seedSkeletonMaps(box);
  await box.write("store/items/a/note.md", "a");
  await box.write("store/items/b/note.md", "b");
  await box.write("store/keep/sub/x.md", "x");
  await box.write("store/keep/sub2/y.md", "y");
  for (const f of extraFiles) await box.write(f, "z");
  box.commitAll("seed");

  const brief = await precheck({
    boxRoot: box.root,
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS, ...SKELETON_HIDDEN_PATHS, pattern],
  });
  const dirs = brief.tasks.map((t) => t.dir || "<root>").toSorted();
  const store = brief.tasks.find((t) => t.dir === "store")!;
  out.push(`${pattern}: dirs=${dirs.join(", ")} store children=${store.children.join(", ")}`);
  await box.cleanup();
}

out.join("\n")
=>
store/items/*: dirs=store, store/keep store children=items/, keep/
store/items/**: dirs=store, store/keep store children=README.md, keep/
```

## An unresolvable asOf is an anomaly, not a diff

When the commit a MAP.md was generated against no longer resolves — history
rewritten, objects GC'd, a shallow clone — there is no trustworthy prior
listing. Diffing against it would report every current child as newly added.
The precheck records an anomaly and downgrades the task to `create`, so the
map is regenerated from HEAD's listing.

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

## Listings come from the committed tree, on every path

The walker, the create listing, and the update listing all read the same git
tree at HEAD. A directory whose only contents are gitignored is not part of
the box's record, so it appears in none of them. Before, the walker and the
create listing read disk while change detection read git: the directory
counted toward its parent's map, never dirtied it, and appeared in the listing
or not depending on which branch ran.

```ts
const box = await makeTmpBox({ git: true });
const skeleton = await seedSkeletonMaps(box);
await box.write(".gitignore", (await box.read(".gitignore")) + "\n*.jpg\n");
await box.write("store/notes/a.md", "a");
await box.write("store/b.md", "b");
await box.write("store/MAP.md", "# Map: store\n");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({ boxRoot: box.root, state: { maps: { ...skeleton, store: { asOf: head, generatedAt: "t" } } } });
box.commitAll("state");

await box.write("store/photos/holiday.jpg", "JPEG");
const quiet = await precheck({ boxRoot: box.root });
print(`needsWork=${quiet.needsWork}`);
=> needsWork=false
```

An unrelated tracked change dirties `store`; the listing still omits the
ignored directory:

```ts continue
await box.write("store/c.md", "c");
box.commitAll("add c");
const update = await precheck({ boxRoot: box.root });
print(update.tasks.map((t) => `${t.dir}:${t.action}:${t.children.join(",")}`).join(" "));
=> store:update:b.md,c.md,notes/
```

The create path, with no state entry, gives the same listing:

```ts continue
await saveMapState({ boxRoot: box.root, state: { maps: skeleton } });
box.commitAll("drop store state");
const create = await precheck({ boxRoot: box.root });
print(create.tasks.map((t) => `${t.dir}:${t.action}:${t.children.join(",")}`).join(" "));
=> store:create:b.md,c.md,notes/
```

A directory holding only ignored files does not make its parent a container
either:

```ts continue
await box.write("solo/pics/one.jpg", "JPEG");
await box.write("solo/pics/two.jpg", "JPEG");
await box.write("solo/readme.md", "r");
await box.write("solo/other.md", "o");
box.commitAll("solo");
const solo = await precheck({ boxRoot: box.root });
print(`solo mapped: ${solo.tasks.some((t) => t.dir === "solo")}`);
=> solo mapped: false
```

```ts cleanup
await box.cleanup();
```

## Non-ASCII names are listed as written

Git quotes non-ASCII paths in its default output (`"caf\303\251.md"`). The
listing reads NUL-separated raw paths, so an added name matches what is on
disk and what the map names.

```ts
const box = await makeTmpBox({ git: true });
const skeleton = await seedSkeletonMaps(box);
await box.write("store/notes/a.md", "a");
await box.write("store/b.md", "b");
await box.write("store/MAP.md", "# Map: store\n");
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({ boxRoot: box.root, state: { maps: { ...skeleton, store: { asOf: head, generatedAt: "t" } } } });
box.commitAll("state");

await box.write("store/café.md", "c");
await box.write("store/résumés/r.md", "r");
box.commitAll("add accented names");
const brief = await precheck({ boxRoot: box.root });
const store = brief.tasks.find((t) => t.dir === "store")!;
print(`added: ${store.added.join(", ")}`);
print(`children: ${store.children.join(", ")}`);
=>
added: café.md, résumés/
children: b.md, café.md, notes/, résumés/
```

```ts cleanup
await box.cleanup();
```

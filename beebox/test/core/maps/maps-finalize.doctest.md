# Map refresh finalize

Tests for `src/core/maps/finalize.ts` — the mechanical post-agent step
that stamps state and ensures `CLAUDE.md` per directory.

```ts setup
import { finalize } from "../../../src/core/maps/finalize.js";
import { loadMapState, saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
```

## Creates CLAUDE.md and stamps state for fresh dirs

When a directory has a MAP.md but no CLAUDE.md, finalize writes a stub
CLAUDE.md with the `@MAP.md` include and stamps the state file.

`head` is the brief-time HEAD — captured *before* the agent writes, since
that's what the precheck records on each task.

```ts
const box = await makeTmpBox({ git: true });
box.commitAll("seed");
const head = await getHead(box.root);
await box.write("inbox/MAP.md", "");
await box.write("MAP.md", "");

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
    { map: "inbox/MAP.md", dir: "inbox", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

print(JSON.stringify(await box.read("CLAUDE.md")));
print(JSON.stringify(await box.read("inbox/CLAUDE.md")));
=>
"@MAP.md\n"
"@MAP.md\n"
```

State file records both at HEAD:

```ts continue
const state = await loadMapState(box.root);
const summary = Object.keys(state.maps).toSorted().map((k) =>
  `${k || "<root>"}: ${state.maps[k]!.asOf === head ? "at-head" : "stale"}`
);
print(summary.join("\n"));
=>
<root>: at-head
inbox: at-head
```

```ts cleanup
await box.cleanup();
```

## A fresh CLAUDE.md gets its AGENTS.md mirror

Codex reads `AGENTS.md`, not `CLAUDE.md`. A stub written without the sibling
symlink leaves the directory's new MAP invisible to a Codex session until some
later `generate-docs` run happens to plant one — so finalize links the file it
just created, and only that file.

```ts
const box = await makeTmpBox({ git: true });
box.commitAll("seed");
const head = await getHead(box.root);
await box.write("store/MAP.md", "");

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "store/MAP.md", dir: "store", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

const mirror = join(box.root, "store", "AGENTS.md");
print(`symlink: ${(await lstat(mirror)).isSymbolicLink()}`);
print(`target: ${await readlink(mirror)}`);
=>
symlink: true
target: CLAUDE.md
```

An existing CLAUDE.md that only needed the include line inserted already has a
mirror beside it, so nothing is relinked:

```ts continue
await box.write("people/MAP.md", "");
await box.write("people/CLAUDE.md", "Hand-written notes.\n");
await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "people/MAP.md", dir: "people", action: "create", head, added: [], deleted: [], children: [] },
  ],
});
print(JSON.stringify(await box.read("people/CLAUDE.md")));
=> "@MAP.md\nHand-written notes.\n"
```

```ts cleanup
await box.cleanup();
```

## Preserves existing CLAUDE.md content

If CLAUDE.md already has hand-edited content, the @-include is added at
the top without disturbing the rest.

```ts
const box = await makeTmpBox({ git: true });
const existing = "# Project notes\n\nSome details.\n";
await box.write("CLAUDE.md", existing);
box.commitAll("seed");
const head = await getHead(box.root);
await box.write("MAP.md", "");

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

print(JSON.stringify(await box.read("CLAUDE.md")));
=> "@MAP.md\n# Project notes\n\nSome details.\n"
```

```ts cleanup
await box.cleanup();
```

## Idempotent — doesn't duplicate the include

```ts
const box = await makeTmpBox({ git: true });
await box.write("CLAUDE.md", "@MAP.md\n# Notes\n");
await box.write("MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

const content = await box.read("CLAUDE.md");
const matches = content.match(/@MAP\.md/g);
print(`occurrences: ${matches ? matches.length : 0}`);
=>
occurrences: 1
```

```ts cleanup
await box.cleanup();
```

## Prunes stale state entries

State entries pointing to directories that no longer exist are removed.

```ts
const box = await makeTmpBox({ git: true });
await box.write("MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);

// Pre-seed state with a stale entry for a directory that doesn't exist.
await saveMapState({
  boxRoot: box.root,
  state: {
    maps: {
      "": { asOf: "old", generatedAt: "t" },
      "ghost-dir": { asOf: "old", generatedAt: "t" },
    },
  },
});

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

const state = await loadMapState(box.root);
print(Object.keys(state.maps).toSorted().join(","));
=>

```

```ts cleanup
await box.cleanup();
```

## Only stamps maps the agent actually rewrote

An `update` task's MAP.md already exists before the agent runs, so its mere
existence proves nothing. Finalize compares each map against the brief-time
HEAD and leaves untouched ones unstamped, so a run that got through only part
of its brief doesn't mark the rest current.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/MAP.md", "# Map: store\n\n(stale)\n");
await box.write("inbox/MAP.md", "# Map: inbox\n\n(stale)\n");
box.commitAll("seed");
const head = await getHead(box.root);

// The agent rewrites store's map and then stops — inbox is never touched.
await box.write("store/MAP.md", "# Map: store\n\n(rewritten)\n");

const result = await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "store/MAP.md", dir: "store", action: "update", asOf: head, head, added: [], deleted: [], children: [] },
    { map: "inbox/MAP.md", dir: "inbox", action: "update", asOf: head, head, added: [], deleted: [], children: [] },
  ],
});

print(`applied: ${result.applied.join(",")}`);
print(`unchanged: ${result.skippedUnchanged.join(",")}`);
=>
applied: store
unchanged: inbox
```

The untouched dir keeps its old `asOf`, so the next run picks it up again:

```ts continue
const state = await loadMapState(box.root);
print(`store stamped: ${state.maps["store"] !== undefined}`);
print(`inbox stamped: ${state.maps["inbox"] !== undefined}`);
=>
store stamped: true
inbox stamped: false
```

```ts cleanup
await box.cleanup();
```

## Banks work the agent left uncommitted

Finalize runs as a procedure run-phase shell, before the engine commits the
step — so the agent's writes are still in the working tree. Evidence has to
see them there, or a run that died before committing would bank nothing.

```ts
const box = await makeTmpBox({ git: true });
await box.write("store/MAP.md", "# Map: store\n\n(stale)\n");
box.commitAll("seed");
const head = await getHead(box.root);

// Rewritten but never committed — the state after an agent runs out of turns.
await box.write("store/MAP.md", "# Map: store\n\n(rewritten)\n");

const result = await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "store/MAP.md", dir: "store", action: "update", asOf: head, head, added: [], deleted: [], children: [] },
  ],
});
print(`applied: ${result.applied.join(",")}`);
=>
applied: store
```

```ts cleanup
await box.cleanup();
```

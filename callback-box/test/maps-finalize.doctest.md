# Map refresh finalize

Tests for `src/core/maps/finalize.ts` — the mechanical post-agent step
that stamps state and ensures `CLAUDE.md` per directory.

```ts setup
import { finalize } from "../src/core/maps/finalize.js";
import { loadMapState, saveMapState } from "../src/core/maps/state.js";
import { getHead } from "../src/cli/lib/git.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Creates CLAUDE.md and stamps state for fresh dirs

When a directory has a MAP.md but no CLAUDE.md, finalize writes a stub
CLAUDE.md with the `@MAP.md` include and stamps the state file.

```
const box = await makeTmpBox({ git: true });
await box.write("inbox/MAP.md", "");
await box.write("MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);

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

``` continue
const state = await loadMapState(box.root);
const summary = Object.keys(state.maps).toSorted().map((k) =>
  `${k || "<root>"}: ${state.maps[k]!.asOf === head ? "at-head" : "stale"}`
);
print(summary.join("\n"));
=>
<root>: at-head
inbox: at-head
```

``` cleanup
await box.cleanup();
```

## Preserves existing CLAUDE.md content

If CLAUDE.md already has hand-edited content, the @-include is added at
the top without disturbing the rest.

```
const box = await makeTmpBox({ git: true });
const existing = "# Project notes\n\nSome details.\n";
await box.write("CLAUDE.md", existing);
await box.write("MAP.md", "");
box.commitAll("seed");
const head = await getHead(box.root);

await finalize({
  boxRoot: box.root,
  tasks: [
    { map: "MAP.md", dir: "", action: "create", head, added: [], deleted: [], children: [] },
  ],
});

print(JSON.stringify(await box.read("CLAUDE.md")));
=> "@MAP.md\n# Project notes\n\nSome details.\n"
```

``` cleanup
await box.cleanup();
```

## Idempotent — doesn't duplicate the include

```
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

``` cleanup
await box.cleanup();
```

## Prunes stale state entries

State entries pointing to directories that no longer exist are removed.

```
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

``` cleanup
await box.cleanup();
```

# Orphan MAP.md files

Tests for `src/core/maps/orphans.ts`. A MAP.md in a directory that no longer
gets one — hidden by an ignore pattern, or no longer meeting the container
and useful-content rules — is never refreshed, yet its CLAUDE.md keeps
importing it into agent context. Pruning deletes the map, the import, and
the state entry.

```ts setup
import { findOrphanMaps, pruneOrphanMaps } from "../../../src/core/maps/orphans.js";
import { loadMapState, saveMapState } from "../../../src/core/maps/state.js";
import { getHead } from "../../../src/lib/git.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { lstat, symlink } from "node:fs/promises";
import { join } from "node:path";

async function exists(box, rel: string): Promise<boolean> {
  return lstat(join(box.root, rel)).then(() => true, () => false);
}
```

## Hidden and non-qualifying directories are orphans; mapped ones are not

`_content/chat/**` is a skeleton-hidden path. `solo/` has one subdirectory
and nothing else, so it fails the useful-content rule. `work/` qualifies. The
box root is never reported: its CLAUDE.md is a managed template.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/chat/MAP.md", "# Map: store/chat\n");
await box.write("_content/chat/CLAUDE.md", "@MAP.md\n");
await box.write("solo/only/a.md", "a");
await box.write("solo/MAP.md", "# Map: solo\n");
await box.write("work/notes/a.md", "a");
await box.write("work/refs/b.md", "b");
await box.write("work/MAP.md", "# Map: work\n");
await box.write("MAP.md", "# Map: (root)\n");
box.commitAll("seed");

const scan = await findOrphanMaps(box.root);
print(scan.ok ? scan.dirs.join(", ") : scan.skippedReason);
=> _content/chat, solo
```

A box with uncommitted user work is left alone, as the refresh precheck
leaves it:

```ts continue
await box.write("work/draft.md", "wip");
const busy = await findOrphanMaps(box.root);
print(busy.ok ? "scanned" : busy.skippedReason);
=> uncommitted_work
```

```ts cleanup
await box.cleanup();
```

## Pruning removes the map, the import, and the state entry

A CLAUDE.md that held only the import is deleted with its AGENTS.md mirror
symlink. A CLAUDE.md with other content keeps that content. A real
AGENTS.md, or a symlink to anything other than `CLAUDE.md`, is never deleted.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_content/chat/MAP.md", "# Map: store/chat\n");
await box.write("_content/chat/CLAUDE.md", "@MAP.md\n");
await symlink("CLAUDE.md", join(box.root, "_content/chat/AGENTS.md"));
await box.write("solo/only/a.md", "a");
await box.write("solo/MAP.md", "# Map: solo\n");
await box.write("solo/CLAUDE.md", "@MAP.md\n\nKeep solo notes short.\n");
await box.write("_content/inbox/MAP.md", "# Map: box/inbox\n");
await box.write("_content/inbox/CLAUDE.md", "@MAP.md\n");
await box.write("_content/inbox/AGENTS.md", "Hand-written Codex notes.\n");
await box.write("old/only/a.md", "a");
await box.write("old/MAP.md", "# Map: old\n");
await box.write("old/CLAUDE.md", "@MAP.md\n");
await box.write("shared/AGENTS.md", "Shared notes.\n");
await symlink("../shared/AGENTS.md", join(box.root, "old/AGENTS.md"));
box.commitAll("seed");
const head = await getHead(box.root);
await saveMapState({ boxRoot: box.root, state: { maps: {
  "solo": { asOf: head, generatedAt: "t" },
  "work": { asOf: head, generatedAt: "t" },
} } });
box.commitAll("state");

const scan = await findOrphanMaps(box.root);
await pruneOrphanMaps(box.root, scan.ok ? scan.dirs : []);

print(`chat: MAP=${await exists(box, "_content/chat/MAP.md")} CLAUDE=${await exists(box, "_content/chat/CLAUDE.md")} AGENTS=${await exists(box, "_content/chat/AGENTS.md")}`);
print(`solo: MAP=${await exists(box, "solo/MAP.md")} CLAUDE=${JSON.stringify(await box.read("solo/CLAUDE.md"))}`);
print(`inbox: CLAUDE=${await exists(box, "_content/inbox/CLAUDE.md")} AGENTS=${await exists(box, "_content/inbox/AGENTS.md")}`);
print(`old: CLAUDE=${await exists(box, "old/CLAUDE.md")} AGENTS=${await exists(box, "old/AGENTS.md")}`);
print(Object.keys((await loadMapState(box.root)).maps).join(","));
=>
chat: MAP=false CLAUDE=false AGENTS=false
solo: MAP=false CLAUDE="\nKeep solo notes short.\n"
inbox: CLAUDE=false AGENTS=true
old: CLAUDE=false AGENTS=true
work
```

After the engine commits the step, nothing is left to prune:

```ts continue
box.commitAll("prune");
const again = await findOrphanMaps(box.root);
print(again.ok ? `orphans: ${again.dirs.length}` : again.skippedReason);
=> orphans: 0
```

```ts cleanup
await box.cleanup();
```

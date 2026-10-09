# Template ledger sibling keys

While boxes move from `CLAUDE.md` to `AGENTS.md`, the template ledger
(`_config/template-versions.json`) and the parked copies
(`_config/_template-updates/<path>`) treat `<dir>/CLAUDE.md` and
`<dir>/AGENTS.md` as one entry. The `agents-md-2026-10` migration renames a
guide, then rekeys its ledger entry, then moves its park; an interruption
between those steps leaves the file under one name and its records under the
other. The sibling-key rule keeps that state working: a lookup for either name
finds whichever key exists, and a write keeps that key. Plan:
`docs/implemented-plans/box-agents-md.md`, Track A and Track B "Intermediate states".

```ts setup
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  hasRecordedTemplateVersion,
  installTemplateFile,
  pruneStaleTemplateUpdates,
} from "../../src/core/install-template-file.js";
import { readTemplateUpdate } from "../../src/core/template-update.js";

const LEGACY = "src/schemas/CLAUDE.md";
const RENAMED = "src/schemas/AGENTS.md";
const V1 = "# Guide\n\nStock one.\n\nRead the docs.\n\n## This box\n\nAdd notes here.\n";
const V2 = "# Guide\n\nStock two.\n\nRead the docs.\n\n## This box\n\nAdd notes here.\n";
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

async function makeBox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-sibling-key-"));
}

async function put(box: string, rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(box, rel)), { recursive: true });
  await fs.writeFile(path.join(box, rel), content);
}

async function ledger(box: string): Promise<Record<string, { sha256?: string; stock?: string; pending?: string }>> {
  return JSON.parse(await fs.readFile(path.join(box, "_config/template-versions.json"), "utf-8"));
}

async function exists(box: string, rel: string): Promise<boolean> {
  return fs.access(path.join(box, rel)).then(() => true, () => false);
}

/** The half-moved state: the guide is renamed, its ledger entry is still under the old key. */
async function halfMoved(content: string): Promise<string> {
  const box = await makeBox();
  await put(box, RENAMED, content);
  await put(box, "_config/template-versions.json", JSON.stringify({
    [LEGACY]: { sha256: sha(V1), "installed-at": "2026-10-01T00:00:00Z", stock: V1 },
  }));
  return box;
}
```

## The renamed guide still reads as installed

The file is stock `V1` under its new name; the ledger records `V1` under the
old key. A new template overwrites it as unmodified stock (no park), and the
entry stays under the key it was found under.

```ts
const box = await halfMoved(V1);
const result = await installTemplateFile({ boxRoot: box, relPath: RENAMED, templateContent: V2 });
const versions = await ledger(box);
({
  outcome: result.outcome,
  content: await fs.readFile(path.join(box, RENAMED), "utf-8"),
  keys: Object.keys(versions),
  recordedV2: versions[LEGACY]?.sha256 === sha(V2),
  parked: await exists(box, `_config/_template-updates/${RENAMED}`),
})
=> { outcome: "overwritten", content: "# Guide\n\nStock two.\n\nRead the docs.\n\n## This box\n\nAdd notes here.\n", keys: ["src/schemas/CLAUDE.md"], recordedV2: true, parked: false }
```

`hasRecordedTemplateVersion` answers for either name:

```ts
const box = await halfMoved(V1);
[await hasRecordedTemplateVersion(box, RENAMED), await hasRecordedTemplateVersion(box, LEGACY)]
=> [true, true]
```

## An edited guide merges against the stock under the old key

A boxholder edit to the renamed guide merges with the new template using the
`stock` recorded under the old key, the same as before the rename.

```ts
const box = await halfMoved(V1.replace("Add notes here.", "A box note."));
const result = await installTemplateFile({ boxRoot: box, relPath: RENAMED, templateContent: V2 });
({ outcome: result.outcome, content: await fs.readFile(path.join(box, RENAMED), "utf-8"), keys: Object.keys(await ledger(box)) })
=> { outcome: "overwritten", content: "# Guide\n\nStock two.\n\nRead the docs.\n\n## This box\n\nA box note.\n", keys: ["src/schemas/CLAUDE.md"] }
```

## A park under the old name is the park for the renamed guide

When the guide cannot merge, the update parks. A park already under the old
name is rewritten in place rather than duplicated under the new one, and the
pending hash goes on the existing key.

```ts
const box = await halfMoved("# Mine\n\nRewritten by the box.\n");
await put(box, `_config/_template-updates/${LEGACY}`, "# Older parked copy\n");
const result = await installTemplateFile({ boxRoot: box, relPath: RENAMED, templateContent: V2 });
({
  outcome: result.outcome,
  writtenAt: result.writtenAt,
  parkedOld: await fs.readFile(path.join(box, `_config/_template-updates/${LEGACY}`), "utf-8"),
  parkedNew: await exists(box, `_config/_template-updates/${RENAMED}`),
  pendingV2: (await ledger(box))[LEGACY]?.pending === sha(V2),
})
=> { outcome: "parked", writtenAt: "_config/_template-updates/src/schemas/CLAUDE.md", parkedOld: "# Guide\n\nStock two.\n\nRead the docs.\n\n## This box\n\nAdd notes here.\n", parkedNew: false, pendingV2: true }
```

`bbx template diff` reads the renamed file, the park under the old name, and
the stock under the old key:

```ts
const box = await halfMoved("# Mine\n");
await put(box, `_config/_template-updates/${LEGACY}`, V2);
const update = await readTemplateUpdate(box, RENAMED);
({ local: update.local, parkedIsV2: update.parked === V2, stockIsV1: update.stock === V1 })
=> { local: "# Mine\n", parkedIsV2: true, stockIsV1: true }
```

When the guide converges to the template, a park under either name is cleared:

```ts
const box = await halfMoved(V1);
await put(box, `_config/_template-updates/${LEGACY}`, V2);
await installTemplateFile({ boxRoot: box, relPath: RENAMED, templateContent: V1 });
await exists(box, `_config/_template-updates/${LEGACY}`)
=> false
```

## Pruning keeps a park whose original was renamed

`pruneStaleTemplateUpdates` removes a park whose original is gone. A park under
`CLAUDE.md` whose guide now lives at `AGENTS.md` still has its original; one
with neither name on disk is an orphan.

```ts
const box = await halfMoved(V1);
await put(box, `_config/_template-updates/${LEGACY}`, V2);
await put(box, "_config/_template-updates/src/views/CLAUDE.md", V2);
await pruneStaleTemplateUpdates(box)
=> ["_config/_template-updates/src/views/CLAUDE.md"]
```

## Only instruction-file names have a sibling

The rule is narrow: any other path keeps its own key.

```ts
const box = await makeBox();
await put(box, "src/schemas/README.md", V1);
await put(box, "_config/template-versions.json", JSON.stringify({
  "src/schemas/CLAUDE.md": { sha256: sha(V1), "installed-at": "2026-10-01T00:00:00Z", stock: V1 },
}));
await hasRecordedTemplateVersion(box, "src/schemas/README.md")
=> false
```

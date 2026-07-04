# Template File Install

`installTemplateFile` is the shared write-path for every template-managed file in a box (procedures, guides, schedules, briefing, root landmark, personality). It tracks the hash of the last template we cleanly wrote into `config/template-versions.json` and uses that to decide whether a new template can safely overwrite the local copy.

The four outcomes:

- `fresh` — file didn't exist; write template, record hash
- `unchanged` — local already matches the new template; no write
- `overwritten` — local matches the previously recorded hash (user hasn't touched it since last install) → safe to overwrite
- `parked` — local diverges from both the new template and the recorded hash → write the new template to `config/_template-updates/<relpath>` for the user to review

`pruneStaleTemplateUpdates` sweeps parked files older than 30 days (configurable) so the review pile doesn't accumulate cruft indefinitely.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  installTemplateFile,
  pruneStaleTemplateUpdates,
  listParkedTemplateUpdates,
} from "../../src/core/install-template-file.js";

async function makeBox() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-install-tpl-"));
}

async function readVersions(box) {
  const text = await fs.readFile(path.join(box, "config/template-versions.json"), "utf-8");
  return JSON.parse(text);
}
```

## Fresh install

A file that doesn't exist gets written and recorded:

```ts
const box = await makeBox();
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/calendar.guide.card",
  templateContent: "v1\n",
});
result.outcome
=> fresh
```

```ts continue
await fs.readFile(path.join(box, "config/calendar.guide.card"), "utf-8")
=> v1
```

```ts continue
const versions = await readVersions(box);
Object.keys(versions)
=> [
  "config/calendar.guide.card"
]
```

## Unchanged — local already matches new template

Re-running with the same template content is a no-op:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v1\n",
});
result.outcome
=> unchanged
```

## Overwritten — local matches last recorded hash → safe push

The boxholder hasn't touched the file since we installed it; a new template version pushes through cleanly:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v2\n",
});
result.outcome
=> overwritten
```

```ts continue
await fs.readFile(path.join(box, "config/x.card"), "utf-8")
=> v2
```

The recorded hash updated to v2:

```ts continue
const versions = await readVersions(box);
versions["config/x.card"].sha256.length
=> 64
```

## Parked — local has been edited; new template diverted to _template-updates/

When the local file differs from the recorded hash, we don't overwrite — we park the new template for the user to review:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
await fs.writeFile(path.join(box, "config/x.card"), "user edit\n");
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v2\n",
});
result.outcome
=> parked
```

The user's edit is preserved:

```ts continue
await fs.readFile(path.join(box, "config/x.card"), "utf-8")
=> user edit
```

The new template sits in `_template-updates/` mirroring the original relpath verbatim — so the copy-back-to-accept path is obvious:

```ts continue
result.writtenAt
=> config/_template-updates/config/x.card

await fs.readFile(path.join(box, result.writtenAt), "utf-8")
=> v2
```

And the recorded hash is **not** updated (so if the user copies the parked version into place later, the next install can recognise it and overwrite cleanly):

```ts continue
const versions = await readVersions(box);
const hashBefore = versions["config/x.card"].sha256;
const result2 = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v2\n",
});
const versions2 = await readVersions(box);
versions2["config/x.card"].sha256 === hashBefore
=> true
```

## Listing parked updates — the drift signal

`listParkedTemplateUpdates` returns the original relpaths that currently have a
parked update, so `cb status` / `/healthz` can surface template drift. A clean box
reports nothing:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
JSON.stringify(await listParkedTemplateUpdates(box))
=> []
```

After the box diverges and a new template parks, the original relpath (not the
mirrored `_template-updates/` path) is listed:

```ts continue
await fs.writeFile(path.join(box, "config/x.card"), "user edit\n");
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v2\n" });
JSON.stringify(await listParkedTemplateUpdates(box))
=> ["config/x.card"]
```

## Bootstrap — pre-existing file with no recorded hash

A box that was installed before the version tracker existed has files but no `template-versions.json` entry. If local matches the new template, we silently adopt the hash:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "config"), { recursive: true });
await fs.writeFile(path.join(box, "config/x.card"), "v1\n");
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v1\n",
});
result.outcome
=> unchanged
```

```ts continue
const versions = await readVersions(box);
versions["config/x.card"].sha256.length
=> 64
```

But if local doesn't match (could be user-edited or an old template version we can't recognise), we park — the conservative call:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "config"), { recursive: true });
await fs.writeFile(path.join(box, "config/x.card"), "mystery content\n");
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/x.card",
  templateContent: "v2\n",
});
result.outcome
=> parked
```

## Normalize — timestamp-only diffs don't read as user edits

Guide templates regenerate their `created-at` timestamps every install. With a `normalize` function we strip the volatile fields before hashing, so reinstalls don't think the user edited the file:

```ts
const box = await makeBox();
const stripTs = (s) => s.replace(/ts="[^"]*"/g, "");
await installTemplateFile({
  boxRoot: box,
  relPath: "config/g.card",
  templateContent: `<guide ts="2026-01-01"/>\n`,
  normalize: stripTs,
});
const result = await installTemplateFile({
  boxRoot: box,
  relPath: "config/g.card",
  templateContent: `<guide ts="2026-05-24"/>\n`,
  normalize: stripTs,
});
result.outcome
=> unchanged
```

## Box-owned fields — a toggle doesn't freeze the box on old content

Some card templates have fields the box owns as per-box *state* rather than definition — the canonical case is a schedule's `enabled`. `boxOwnedFields` strips those before the customised-or-not comparison, so a box that only toggled `enabled` still reads as unmodified stock and takes a definition update, with its own `enabled` carried onto the new version.

A box installs a schedule, disables it, then upstream ships a new definition:

```ts
const box = await makeBox();
const rel = "config/schedules/s.scheduled-script.card";
const v1 = "---\nruns: cb sync\ndescription: v1\n---\n";
await installTemplateFile({ boxRoot: box, relPath: rel, templateContent: v1 });
// Box disables it (adds enabled: false), touching nothing else:
await fs.writeFile(path.join(box, rel), "---\nruns: cb sync\ndescription: v1\nenabled: false\n---\n");
const v2 = "---\nruns: cb sync\ndescription: v2\n---\n";
const result = await installTemplateFile({
  boxRoot: box,
  relPath: rel,
  templateContent: v2,
  boxOwnedFields: ["enabled"],
});
result.outcome
=> overwritten
```

The box now has the new definition (`v2`) with its own `enabled: false` preserved — not parked, not re-enabled:

```ts continue
await fs.readFile(path.join(box, rel), "utf-8")
=>
---
runs: cb sync
description: v2
enabled: false
---
```

But an edit *beyond* the owned fields still parks — the box's real customization is never clobbered:

```ts
const box = await makeBox();
const rel = "config/schedules/s.scheduled-script.card";
const v1 = "---\nruns: cb sync\ndescription: v1\n---\n";
await installTemplateFile({ boxRoot: box, relPath: rel, templateContent: v1 });
// Box disables AND retimes it (edits the definition):
await fs.writeFile(path.join(box, rel), "---\nruns: cb sync --fast\ndescription: v1\nenabled: false\n---\n");
const result = await installTemplateFile({
  boxRoot: box,
  relPath: rel,
  templateContent: "---\nruns: cb sync\ndescription: v2\n---\n",
  boxOwnedFields: ["enabled"],
});
result.outcome
=> parked
```

When the box is already on current content and only differs by the toggle, it's `unchanged` — the box keeps its `enabled`, nothing is rewritten:

```ts
const box = await makeBox();
const rel = "config/schedules/s.scheduled-script.card";
const v = "---\nruns: cb sync\ndescription: v1\n---\n";
await installTemplateFile({ boxRoot: box, relPath: rel, templateContent: v });
await fs.writeFile(path.join(box, rel), "---\nruns: cb sync\ndescription: v1\nenabled: false\n---\n");
const result = await installTemplateFile({
  boxRoot: box,
  relPath: rel,
  templateContent: v,
  boxOwnedFields: ["enabled"],
});
result.outcome
=> unchanged
```

## Pruning stale parked files

`pruneStaleTemplateUpdates` deletes files in `config/_template-updates/` older than the threshold (default 30 days). Recent parks are left alone. Each mirror has its on-disk target present (the realistic case — a mirror is only ever parked because an on-disk copy diverged), so only *age* decides removal here:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "config/_template-updates"), { recursive: true });
await fs.writeFile(path.join(box, "old.card"), "local\n");
await fs.writeFile(path.join(box, "new.card"), "local\n");
const oldFile = path.join(box, "config/_template-updates/old.card");
const newFile = path.join(box, "config/_template-updates/new.card");
await fs.writeFile(oldFile, "old\n");
await fs.writeFile(newFile, "new\n");
const now = Date.now();
const oldTime = new Date(now - 40 * 24 * 60 * 60 * 1000);
await fs.utimes(oldFile, oldTime, oldTime);

const removed = await pruneStaleTemplateUpdates(box, { now });
removed
=> [
  "config/_template-updates/old.card"
]
```

The recent file survives:

```ts continue
await fs.access(newFile).then(() => true).catch(() => false)
=> true
```

The old file is gone:

```ts continue
await fs.access(oldFile).then(() => true).catch(() => false)
=> false
```

When `_template-updates/` doesn't exist, prune is a silent no-op:

```ts
const box = await makeBox();
const removed = await pruneStaleTemplateUpdates(box);
removed
=> []
```

Empty subdirectories are swept after files:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "procedures"), { recursive: true });
await fs.writeFile(path.join(box, "procedures/x.procedure.card"), "local\n");
const subdir = path.join(box, "config/_template-updates/procedures");
await fs.mkdir(subdir, { recursive: true });
const stale = path.join(subdir, "x.procedure.card");
await fs.writeFile(stale, "stale\n");
const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
await fs.utimes(stale, old, old);

await pruneStaleTemplateUpdates(box);
await fs.access(subdir).then(() => true).catch(() => false)
=> false
```

A subdir that still holds a non-stale file (with its on-disk target present) is left in place — the sweep is best-effort and silent, so a non-empty directory is not an error:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "procedures"), { recursive: true });
await fs.writeFile(path.join(box, "procedures/old.procedure.card"), "local\n");
await fs.writeFile(path.join(box, "procedures/fresh.procedure.card"), "local\n");
const subdir = path.join(box, "config/_template-updates/procedures");
await fs.mkdir(subdir, { recursive: true });
const stale = path.join(subdir, "old.procedure.card");
await fs.writeFile(stale, "stale\n");
await fs.writeFile(path.join(subdir, "fresh.procedure.card"), "fresh\n");
const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
await fs.utimes(stale, old, old);

const removed = await pruneStaleTemplateUpdates(box);
[removed, await fs.access(subdir).then(() => true).catch(() => false)]
=>
[
  [
    "config/_template-updates/procedures/old.procedure.card"
  ],
  true
]
```

### Orphaned mirrors are reaped regardless of age

A parked mirror whose on-disk `<relpath>` no longer exists (the copy was deleted, or a relpath-scheme migration renamed it) is drift-count noise — nothing for it to update. It's removed even when recent:

```ts
const box = await makeBox();
const subdir = path.join(box, "config/_template-updates/procedures");
await fs.mkdir(subdir, { recursive: true });
// Freshly parked (mtime = now) but NO on-disk box/procedures/gone.procedure.card:
await fs.writeFile(path.join(subdir, "gone.procedure.card"), "orphan\n");

const removed = await pruneStaleTemplateUpdates(box, { now: Date.now() });
removed
=> [
  "config/_template-updates/procedures/gone.procedure.card"
]
```

## Convergence clears the parked mirror

Once a divergent box comes back into line with the template — the boxholder copies the parked update into place, or a migration strips the diverging field — the next `installTemplateFile` sees a match and clears the obsolete mirror. This is what keeps the drift count tracking *real* divergence instead of a pile of stale "update available" entries.

Park an update by diverging the local copy, then bring it back in line:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
await fs.writeFile(path.join(box, "config/x.card"), "user edit\n");
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v2\n" });
JSON.stringify(await listParkedTemplateUpdates(box))
=> ["config/x.card"]
```

The local reverts to the last cleanly-installed version (recorded hash = v1), so a fresh v2 push is now a clean `overwritten` — and the obsolete mirror is cleared:

```ts continue
await fs.writeFile(path.join(box, "config/x.card"), "v1\n");
const result = await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v2\n" });
result.outcome
=> overwritten

JSON.stringify(await listParkedTemplateUpdates(box))
=> []
```

An `unchanged` outcome clears it too — e.g. a migration edits the local file to match the current template:

```ts
const box = await makeBox();
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v1\n" });
await fs.writeFile(path.join(box, "config/x.card"), "user edit\n");
await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v2\n" });
await fs.writeFile(path.join(box, "config/x.card"), "v2\n");
const result = await installTemplateFile({ boxRoot: box, relPath: "config/x.card", templateContent: "v2\n" });
result.outcome
=> unchanged

JSON.stringify(await listParkedTemplateUpdates(box))
=> []
```

## v2 (package-layout) boxes: a `../`-prefixed relPath reaches the package root

A v2 box's three CLAUDE.md guides (schemas, views, tricks) live one level up
from `boxRoot` (`content/`), at the package root's `src/`. `relPath` starting
with `../` is resolved the normal way — `path.join` walks it up — so the
target lands outside `boxRoot` while the tracker bookkeeping
(`template-versions.json`) stays inside it, tracked with the box's own git
history:

```ts continue
async function makePackageBox() {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cb-install-tpl-pkg-"));
  const boxRoot = path.join(packageRoot, "content");
  await fs.mkdir(boxRoot, { recursive: true });
  return { packageRoot, boxRoot };
}

const { packageRoot, boxRoot } = await makePackageBox();
const fresh = await installTemplateFile({
  boxRoot,
  relPath: "../src/schemas/CLAUDE.md",
  templateContent: "v1\n",
});
fresh.outcome
=> fresh

await fs.readFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "utf-8")
=> v1

const versions = await readVersions(boxRoot);
JSON.stringify(Object.keys(versions))
=> ["../src/schemas/CLAUDE.md"]
```

A divergent local copy still parks — but the mirror stays INSIDE `boxRoot`
(the leading `../` is stripped, not carried into `config/_template-updates/`,
which would otherwise try to escape it):

```ts continue
await fs.writeFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "user edit\n");
const parked = await installTemplateFile({
  boxRoot,
  relPath: "../src/schemas/CLAUDE.md",
  templateContent: "v2\n",
});
parked.outcome
=> parked

parked.writtenAt
=> config/_template-updates/src/schemas/CLAUDE.md

await fs.readFile(path.join(boxRoot, parked.writtenAt), "utf-8")
=> v2

await fs.readFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "utf-8")
=> user edit
```

Bringing the local copy back in line clears the mirror, same as the legacy case:

```ts continue
await fs.writeFile(path.join(packageRoot, "src/schemas/CLAUDE.md"), "v1\n");
const overwritten = await installTemplateFile({
  boxRoot,
  relPath: "../src/schemas/CLAUDE.md",
  templateContent: "v2\n",
});
overwritten.outcome
=> overwritten

JSON.stringify(await listParkedTemplateUpdates(boxRoot))
=> []
```

```ts cleanup
await fs.rm(packageRoot, { recursive: true, force: true });
```

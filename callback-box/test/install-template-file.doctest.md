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
} from "../src/core/install-template-file.js";

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

## Pruning stale parked files

`pruneStaleTemplateUpdates` deletes files in `config/_template-updates/` older than the threshold (default 30 days). Recent parks are left alone:

```ts
const box = await makeBox();
await fs.mkdir(path.join(box, "config/_template-updates"), { recursive: true });
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

A subdir that still holds a non-stale file is left in place — the sweep is best-effort and silent, so a non-empty directory is not an error:

```ts
const box = await makeBox();
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

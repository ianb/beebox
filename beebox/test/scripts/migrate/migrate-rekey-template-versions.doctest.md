# Migration: re-key the template tracker onto v3 paths

`scripts/migrate/rekey-template-versions.ts` repairs
`_config/template-versions.json`, whose keys the one-root migration left on
pre-one-root paths. Each key is decided by what is on disk: a key whose file
exists is kept, a key whose file is missing is re-keyed when its v3 path
exists, and anything else is dropped.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { rekeyTemplateVersions } from "../../../scripts/migrate/rekey-template-versions.js";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const TRACKER = "_config/template-versions.json";
const entry = (sha: string, installedAt: string) => ({ sha256: sha, "installed-at": installedAt });

async function tracker(box) {
  return JSON.parse(await box.read(TRACKER));
}
```

## A moved file's entry follows it

```ts
const box = await makeTmpBox();
await box.write("_config/calendar.guide.card", "guide\n");
await box.write(TRACKER, JSON.stringify({
  "config/calendar.guide.card": entry("aaa", "2026-07-19T00:00:00.000Z"),
}));
const result = await rekeyTemplateVersions({ boxRoot: box.root, apply: true });
JSON.stringify(result)
=> {"rekeyed":{"config/calendar.guide.card":"_config/calendar.guide.card"},"dropped":[]}

JSON.stringify(await tracker(box))
=> {"_config/calendar.guide.card":{"sha256":"aaa","installed-at":"2026-07-19T00:00:00.000Z"}}
```

Re-running changes nothing:

```ts continue
JSON.stringify(await rekeyTemplateVersions({ boxRoot: box.root, apply: true }))
=> {"rekeyed":{},"dropped":[]}
```

```ts cleanup
await box.cleanup();
```

## A v3 key that the content-relative mapping would move is left alone

`src/views/CLAUDE.md` is already a v3 path, but `mapV2Path` is
content-relative and would send it to `_content/src/views/CLAUDE.md`. The
file exists, so the key is kept.

```ts
const box = await makeTmpBox();
await box.write("src/views/CLAUDE.md", "views guide\n");
await box.write(TRACKER, JSON.stringify({ "src/views/CLAUDE.md": entry("bbb", "2026-09-12T00:00:00.000Z") }));
const result = await rekeyTemplateVersions({ boxRoot: box.root, apply: true });
[JSON.stringify(result), Object.keys(await tracker(box)).join(",")].join(" | ")
=> {"rekeyed":{},"dropped":[]} | src/views/CLAUDE.md
```

```ts cleanup
await box.cleanup();
```

## When both keys are present, the later install wins

The file on disk came from the later install, so its hash is the one that
describes it.

```ts
const box = await makeTmpBox();
await box.write("_config/procedures/view-card-shape.procedure.card", "card\n");
await box.write(TRACKER, JSON.stringify({
  "config/procedures/view-card-shape.procedure.card": entry("old", "2026-07-21T00:00:00.000Z"),
  "_config/procedures/view-card-shape.procedure.card": entry("new", "2026-09-12T00:00:00.000Z"),
}));
await rekeyTemplateVersions({ boxRoot: box.root, apply: true });
JSON.stringify(await tracker(box))
=> {"_config/procedures/view-card-shape.procedure.card":{"sha256":"new","installed-at":"2026-09-12T00:00:00.000Z"}}
```

```ts cleanup
await box.cleanup();
```

## An entry tracking no file is dropped

A key that escapes the box goes too, whatever sits at that path outside it:
field trackers carry keys like `../src/views/CLAUDE.md`, and the box does not
own what they name.

```ts
const box = await makeTmpBox();
await box.write(TRACKER, JSON.stringify({
  "views/CLAUDE.md": entry("ccc", "2026-06-01T00:00:00.000Z"),
  "../escape.md": entry("ddd", "2026-06-01T00:00:00.000Z"),
}));
const escapeTarget = join(box.root, "..", "escape.md");
await writeFile(escapeTarget, "outside the box\n");
const result = await rekeyTemplateVersions({ boxRoot: box.root, apply: true });
await rm(escapeTarget);
[JSON.stringify(result), JSON.stringify(await tracker(box))].join(" | ")
=> {"rekeyed":{},"dropped":["views/CLAUDE.md","../escape.md"]} | {}
```

```ts cleanup
await box.cleanup();
```

## Dry run writes nothing; a box with no tracker is a no-op

```ts
const box = await makeTmpBox();
await box.write("_config/calendar.guide.card", "guide\n");
await box.write(TRACKER, JSON.stringify({ "config/calendar.guide.card": entry("aaa", "2026-07-19T00:00:00.000Z") }));
const dry = await rekeyTemplateVersions({ boxRoot: box.root, apply: false });
[Object.keys(dry.rekeyed).length, Object.keys(await tracker(box)).join(",")].join(" | ")
=> 1 | config/calendar.guide.card
```

```ts continue
const bare = await makeTmpBox();
JSON.stringify(await rekeyTemplateVersions({ boxRoot: bare.root, apply: true }))
=> {"rekeyed":{},"dropped":[]}
```

```ts cleanup
await box.cleanup();
```

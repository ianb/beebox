# `bbx migrate --mark-applied <name>`

Records a single migration as applied **without running it** — the escape hatch
for a box already in a migration's post-state that never got the manifest entry
(e.g. the retired `bill` migrator, which can no longer run). Unlike
`--mark-all-applied` (seeds a whole missing manifest), this appends one entry to
a box that already has a manifest. `markMigrationApplied` is the pure core the
CLI action wraps.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { markMigrationApplied } from "../../../src/cli/commands/migrate.js";
import { MANIFEST_PATH } from "../../../src/core/migrations.js";

async function makeBox(entries) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-markapplied-"));
  if (entries !== null) {
    const abs = path.join(tmp, MANIFEST_PATH);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const text = entries.map((n) => JSON.stringify({ name: n, "applied-at": "2026-01-01T00:00:00.000Z" })).join("\n");
    await fs.writeFile(abs, entries.length > 0 ? text + "\n" : "");
  }
  return tmp;
}

async function readManifestNames(boxRoot) {
  const text = await fs.readFile(path.join(boxRoot, MANIFEST_PATH), "utf-8");
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l).name);
}
```

## Marks a pending migration as applied and appends the entry

```ts
const box = await makeBox(["attachments", "card-frontmatter"]);
const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
JSON.stringify(result)
=> {"status":"marked"}

(await readManifestNames(box)).join(",")
=> attachments,card-frontmatter,bill
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## A second mark is an idempotent no-op

```ts
const box = await makeBox(["bill"]);
const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
JSON.stringify(result)
=> {"status":"already-applied"}

(await readManifestNames(box)).join(",")
=> bill
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## Refuses an unknown migration name (no manifest write)

```ts
const box = await makeBox(["attachments"]);
const result = await markMigrationApplied({ boxRoot: box, name: "not-a-real-migration" });
JSON.stringify(result)
=> {"status":"unknown-migration"}

(await readManifestNames(box)).join(",")
=> attachments
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## Refuses a box with no manifest (use `--mark-all-applied` first)

```ts
const box = await makeBox(null);
const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
JSON.stringify(result)
=> {"status":"no-manifest"}
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

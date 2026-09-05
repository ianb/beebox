# Persisted state migration

The first `bbx` invocation moves a box's old hidden state directory to
`.beebox` with one same-filesystem rename. It never merges two directories.

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateBoxState, PersistedStateConflictError } from "../../src/lib/state-migration.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-state-migration-"));
async function migrationConflict(): Promise<boolean> {
  try {
    await migrateBoxState(root);
    return false;
  } catch (error) {
    return error instanceof PersistedStateConflictError;
  }
}
```

## Old-only state moves and repeated migration is a no-op

```ts
fs.mkdirSync(path.join(root, ".callback-box"));
fs.writeFileSync(path.join(root, ".callback-box", "state.json"), "old\n");
print(await migrateBoxState(root));
print(fs.readFileSync(path.join(root, ".beebox", "state.json"), "utf-8").trim());
print(await migrateBoxState(root));
=> migrated
old
unchanged
```

## Both paths fail closed

```ts
fs.mkdirSync(path.join(root, ".callback-box"));
print(await migrationConflict());
=> true
```

## An empty canonical directory is not a second generation

Something creating `.beebox/` ahead of the migration (a booting hub child, a
`mkdir -p`) used to leave the box refusing every command until a person
deleted the empty directory. Empty means nothing to merge.

```ts
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-empty-new-migration-"));
fs.mkdirSync(path.join(emptyRoot, ".callback-box"));
fs.writeFileSync(path.join(emptyRoot, ".callback-box", "state.json"), "old\n");
fs.mkdirSync(path.join(emptyRoot, ".beebox"));
print(await migrateBoxState(emptyRoot));
print(fs.readFileSync(path.join(emptyRoot, ".beebox", "state.json"), "utf-8").trim());
print(fs.existsSync(path.join(emptyRoot, ".callback-box")));
fs.rmSync(emptyRoot, { recursive: true, force: true });
=> migrated
old
false
```

## The legacy box marker joins the canonical state directory

```ts
const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-marker-migration-"));
fs.writeFileSync(path.join(markerRoot, ".cb-box"), '{"shapeVersion":2}\n');
print(await migrateBoxState(markerRoot));
print(fs.existsSync(path.join(markerRoot, ".cb-box")));
print(fs.readFileSync(path.join(markerRoot, ".beebox", "box.json"), "utf-8").trim());
fs.rmSync(markerRoot, { recursive: true, force: true });
=> migrated
false
{"shapeVersion":2}
```

## Concurrent callers serialize and converge

```ts
const concurrentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-concurrent-migration-"));
fs.mkdirSync(path.join(concurrentRoot, ".callback-box"));
fs.writeFileSync(path.join(concurrentRoot, ".callback-box", "state.json"), "old\n");
const results = await Promise.all([migrateBoxState(concurrentRoot), migrateBoxState(concurrentRoot)]);
print(results.toSorted().join(","));
print(`${fs.existsSync(path.join(concurrentRoot, ".callback-box"))}:${fs.existsSync(path.join(concurrentRoot, ".beebox"))}`);
fs.rmSync(concurrentRoot, { recursive: true, force: true });
=> migrated,unchanged
false:true
```

```ts cleanup
fs.rmSync(root, { recursive: true, force: true });
```

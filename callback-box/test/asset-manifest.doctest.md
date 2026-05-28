# Asset Manifest Helpers

Per-`.attach/` manifest format, hashing, and load/save. See
`docs/asset-manifests.md` for the design.

```ts setup
import {
  emptyManifest,
  findEntry,
  loadManifest,
  saveManifest,
  entryMatchesStat,
  computeEntry,
  sha256File,
  manifestPath,
  MANIFEST_FILENAME,
} from "../src/core/asset-manifest.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { stat } from "node:fs/promises";

async function caught<T>(fn: () => Promise<T>): Promise<Error | null> {
  try { await fn(); return null; } catch (e) { return e as Error; }
}
```

## Empty manifest shape

```
JSON.stringify(emptyManifest())
=> {"files":{}}
```

## Manifest filename + path

```
MANIFEST_FILENAME
=> manifest.json
```

```
manifestPath("/box/inbox/foo.attach")
=> /box/inbox/foo.attach/manifest.json
```

## sha256File against the FIPS known-answer

The SHA-256 of the three-byte string `abc` is in FIPS 180-4.

```
const box = await makeTmpBox();
await box.write("sample.txt", "abc");
await sha256File(box.path("sample.txt"))
=> ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

```cleanup
await box.cleanup();
```

## computeEntry fills size, mtime, sha256

```
const box2 = await makeTmpBox();
await box2.write("foo.attach/photo.jpg", "abc");
const entry = await computeEntry(box2.path("foo.attach/photo.jpg"));
print(`size=${entry.size}`);
print(`mtime is iso: ${/^\d{4}-\d{2}-\d{2}T/.test(entry.mtime)}`);
print(`sha=${entry.sha256}`)
=>
size=3
mtime is iso: true
sha=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

```cleanup
await box2.cleanup();
```

## loadManifest returns empty when manifest.json doesn't exist

A fresh attach dir with no manifest reads as the empty manifest — so the
hook can treat "never been claimed" the same as "manifest with no
entries."

```
const box3 = await makeTmpBox();
await box3.write("foo.attach/.gitkeep", "");
const m = await loadManifest(box3.path("foo.attach"));
JSON.stringify(m)
=> {"files":{}}
```

```cleanup
await box3.cleanup();
```

## Roundtrip save then load

```
const box4 = await makeTmpBox();
const m = emptyManifest();
m.files["photo-001.jpg"] = {
  size: 660285,
  mtime: "2026-05-04T18:34:59.000Z",
  sha256: "abc123",
};
m.files["photo-001-back.jpg"] = {
  size: 482193,
  mtime: "2026-05-04T18:35:01.000Z",
  sha256: "def456",
};
await saveManifest(box4.path("foo.attach"), m);
const reloaded = await loadManifest(box4.path("foo.attach"));
print(`count=${Object.keys(reloaded.files).length}`);
print(`p1=${reloaded.files["photo-001.jpg"].sha256}`);
print(`p2=${reloaded.files["photo-001-back.jpg"].size}`)
=>
count=2
p1=abc123
p2=482193
```

```cleanup
await box4.cleanup();
```

## Save sorts entries by name for stable diffs

```
const box5 = await makeTmpBox();
const m = emptyManifest();
m.files["z.jpg"] = { size: 1, mtime: "2026-05-04T00:00:00.000Z", sha256: "z" };
m.files["a.jpg"] = { size: 1, mtime: "2026-05-04T00:00:00.000Z", sha256: "a" };
m.files["m.jpg"] = { size: 1, mtime: "2026-05-04T00:00:00.000Z", sha256: "m" };
await saveManifest(box5.path("foo.attach"), m);
const raw = await box5.read("foo.attach/manifest.json");
// Order in the JSON should be a, m, z.
const indexA = raw.indexOf("\"a.jpg\"");
const indexM = raw.indexOf("\"m.jpg\"");
const indexZ = raw.indexOf("\"z.jpg\"");
indexA < indexM && indexM < indexZ
=> true
```

```cleanup
await box5.cleanup();
```

## Malformed manifest is rejected loudly

If somebody hand-edits the file into garbage, we'd rather error than
silently treat the dir as un-manifested (which would let the hook
re-claim everything, wiping legitimate state).

```
const box6 = await makeTmpBox();
await box6.write("foo.attach/manifest.json", JSON.stringify({ files: "not an object" }));
const err = await caught(() => loadManifest(box6.path("foo.attach")));
err !== null && err.message.includes("malformed")
=> true
```

```cleanup
await box6.cleanup();
```

## findEntry locates by filename

```
const m = emptyManifest();
m.files["photo.jpg"] = { size: 10, mtime: "2026-05-04T00:00:00.000Z", sha256: "x" };
print(`found: ${findEntry(m, "photo.jpg") !== undefined}`);
print(`missing: ${findEntry(m, "other.jpg") === undefined}`)
=>
found: true
missing: true
```

## entryMatchesStat: mtime + size shortcut

The hook uses this to skip rehashing files that haven't changed. Hash
isn't part of the comparison — that's the point: trust mtime+size for
speed, fall back to rehash on mismatch.

```
const box7 = await makeTmpBox();
await box7.write("foo.attach/photo.jpg", "abc");
const fileStat = await stat(box7.path("foo.attach/photo.jpg"));
const matchingEntry = {
  size: fileStat.size,
  mtime: fileStat.mtime.toISOString(),
  sha256: "doesnt-matter-for-this-check",
};
const differentMtime = { ...matchingEntry, mtime: "2020-01-01T00:00:00.000Z" };
const differentSize = { ...matchingEntry, size: 999 };
print(`match: ${entryMatchesStat(matchingEntry, fileStat)}`);
print(`mtime differs: ${entryMatchesStat(differentMtime, fileStat)}`);
print(`size differs: ${entryMatchesStat(differentSize, fileStat)}`)
=>
match: true
mtime differs: false
size differs: false
```

```cleanup
await box7.cleanup();
```

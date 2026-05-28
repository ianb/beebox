# Asset Manifest Scan

The directory walk that reconciles every `.attach/` manifest against
on-disk reality. Drives the pre-commit hook, migration, and verify.

```ts setup
import {
  findAttachScopes,
  scanAttachScope,
  scanBoxAttachments,
} from "../src/core/asset-manifest-scan.js";
import { loadManifest } from "../src/core/asset-manifest.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { utimes } from "node:fs/promises";

// Backdate a file's mtime so subsequent writes show as "changed."
async function backdate(path: string) {
  const old = new Date("2020-01-01T00:00:00Z");
  await utimes(path, old, old);
}

async function fileExists(p: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try { await access(p); return true; } catch { return false; }
}
```

## findAttachScopes locates every .attach directory

```
const box = await makeTmpBox();
await box.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
await box.write("box/inbox/scan-1.attach/photo-001.image.attach/photo-001.jpg", "def");
await box.write("store/old/voice.attach/audio.webm", "ghi");
await box.write("notes/random.txt", "irrelevant");
const scopes = await findAttachScopes(box.root);
scopes.map(s => s.relPath).toSorted().join("\n")
=>
box/inbox/scan-1.attach
box/inbox/scan-1.attach/photo-001.image.attach
store/old/voice.attach
```

```cleanup
await box.cleanup();
```

## Auto-claim: new files get added to the manifest

```
const box2 = await makeTmpBox();
await box2.write("foo.attach/photo-001.jpg", "abc");
await box2.write("foo.attach/photo-002.jpg", "def");
const result = await scanAttachScope({
  absPath: box2.path("foo.attach"),
  relPath: "foo.attach",
});
print(`claimed: ${result.claimed.toSorted().join(", ")}`);
print(`errors: ${result.errors.length}`);
const m = await loadManifest(box2.path("foo.attach"));
print(`manifest count: ${Object.keys(m.files).length}`);
print(`p1 sha: ${m.files["photo-001.jpg"].sha256}`)
=>
claimed: photo-001.jpg, photo-002.jpg
errors: 0
manifest count: 2
p1 sha: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

```cleanup
await box2.cleanup();
```

## Stable file: untouched mtime+size skips rehash

A second scan of an already-claimed file should be a no-op: file ends up
in `unchanged`, not in `claimed` or `refreshed`.

```
const box3 = await makeTmpBox();
await box3.write("foo.attach/photo.jpg", "abc");
await scanAttachScope({ absPath: box3.path("foo.attach"), relPath: "foo.attach" });
// Reload manifest so mtime there matches disk, then scan again
const r2 = await scanAttachScope({ absPath: box3.path("foo.attach"), relPath: "foo.attach" });
print(`claimed: ${r2.claimed.length}`);
print(`refreshed: ${r2.refreshed.length}`);
print(`unchanged: ${r2.unchanged.join(",")}`);
print(`manifestUpdated: ${r2.manifestUpdated}`)
=>
claimed: 0
refreshed: 0
unchanged: photo.jpg
manifestUpdated: false
```

```cleanup
await box3.cleanup();
```

## Mtime bump but same content: refresh, no error

If a file's mtime moves (touch, format, copy-restore) but content is
identical, the scan refreshes the manifest mtime so the stat-shortcut
keeps working — and surfaces this as `refreshed`, not an error.

```
const box4 = await makeTmpBox();
await box4.write("foo.attach/photo.jpg", "abc");
await scanAttachScope({ absPath: box4.path("foo.attach"), relPath: "foo.attach" });
// Touch the file (write same content, new mtime).
await box4.write("foo.attach/photo.jpg", "abc");
const r = await scanAttachScope({ absPath: box4.path("foo.attach"), relPath: "foo.attach" });
print(`refreshed: ${r.refreshed.join(",")}`);
print(`errors: ${r.errors.length}`)
=>
refreshed: photo.jpg
errors: 0
```

```cleanup
await box4.cleanup();
```

## Content modified out of band: block with hash-mismatch error

If both mtime AND hash differ, that's a real out-of-band edit. Manifest
left alone, error returned.

```
const box5 = await makeTmpBox();
await box5.write("foo.attach/photo.jpg", "abc");
await scanAttachScope({ absPath: box5.path("foo.attach"), relPath: "foo.attach" });
// Edit the file (different content).
await box5.write("foo.attach/photo.jpg", "abcdef");
const r = await scanAttachScope({ absPath: box5.path("foo.attach"), relPath: "foo.attach" });
print(`error count: ${r.errors.length}`);
print(`error kind: ${r.errors[0].kind}`);
print(`error name: ${r.errors[0].name}`);
print(`mentions cb overwrite: ${r.errors[0].message.includes("cb overwrite")}`)
=>
error count: 1
error kind: hash-mismatch
error name: photo.jpg
mentions cb overwrite: true
```

```cleanup
await box5.cleanup();
```

## Missing file: manifest entry without a sibling on disk

```
const box6 = await makeTmpBox();
await box6.write("foo.attach/photo.jpg", "abc");
await scanAttachScope({ absPath: box6.path("foo.attach"), relPath: "foo.attach" });
// Remove the file directly (bypass cb rm).
const { unlink } = await import("node:fs/promises");
await unlink(box6.path("foo.attach/photo.jpg"));
const r = await scanAttachScope({ absPath: box6.path("foo.attach"), relPath: "foo.attach" });
print(`error count: ${r.errors.length}`);
print(`error kind: ${r.errors[0].kind}`);
print(`mentions cb rm: ${r.errors[0].message.includes("cb rm")}`)
=>
error count: 1
error kind: missing-file
mentions cb rm: true
```

```cleanup
await box6.cleanup();
```

## Rename detected by hash match

`mv old.jpg new.jpg` inside an attach dir should be picked up as a
rename, not deletion + add. The manifest entry's original metadata
(sha256 obviously, but also size/mtime as stored) carries over.

```
const box7 = await makeTmpBox();
await box7.write("foo.attach/old.jpg", "abc");
await scanAttachScope({ absPath: box7.path("foo.attach"), relPath: "foo.attach" });
// Rename via the filesystem.
const { rename } = await import("node:fs/promises");
await rename(box7.path("foo.attach/old.jpg"), box7.path("foo.attach/new.jpg"));
const r = await scanAttachScope({ absPath: box7.path("foo.attach"), relPath: "foo.attach" });
print(`renamed: ${r.renamed[0].from} -> ${r.renamed[0].to}`);
print(`errors: ${r.errors.length}`);
const m = await loadManifest(box7.path("foo.attach"));
print(`old in manifest: ${"old.jpg" in m.files}`);
print(`new in manifest: ${"new.jpg" in m.files}`)
=>
renamed: old.jpg -> new.jpg
errors: 0
old in manifest: false
new in manifest: true
```

```cleanup
await box7.cleanup();
```

## Cards in attach scope are NOT tracked

Cards (.card files) commit normally — they're text, not binaries — so
the manifest scan ignores them. An attach dir containing only cards
(no binaries) produces no manifest at all.

```
const box8 = await makeTmpBox();
await box8.write("session.attach/photo-001.image.card", "<image status='new'/>\n");
const r = await scanAttachScope({ absPath: box8.path("session.attach"), relPath: "session.attach" });
print(`claimed: ${r.claimed.length}`);
print(`manifestUpdated: ${r.manifestUpdated}`);
print(`manifest file exists: ${await fileExists(box8.path("session.attach/manifest.json"))}`)
=>
claimed: 0
manifestUpdated: false
manifest file exists: false
```

```cleanup
await box8.cleanup();
```

## Dry-run: classify without writing

`dryRun: true` returns the same classification but never touches disk.
Used by `cb attachments verify` (read-only check) and by tests.

```
const box9 = await makeTmpBox();
await box9.write("foo.attach/photo.jpg", "abc");
const r = await scanAttachScope(
  { absPath: box9.path("foo.attach"), relPath: "foo.attach" },
  { dryRun: true }
);
print(`claimed: ${r.claimed.join(",")}`);
print(`manifestUpdated: ${r.manifestUpdated}`);
print(`manifest file exists: ${await fileExists(box9.path("foo.attach/manifest.json"))}`)
=>
claimed: photo.jpg
manifestUpdated: false
manifest file exists: false
```

```cleanup
await box9.cleanup();
```

## Recursion into plain subdirectories within a scope

An attach scope's manifest covers every binary anywhere inside it, except
inside nested `.attach/` directories (which have their own manifests).
The classic case: email threads store attachments under
`<thread>.attach/msg-001.attach/attachments/<file>`. The `attachments/`
subdir is part of the surrounding `msg-001.attach` scope, not a separate
scope.

```
const boxR = await makeTmpBox();
await boxR.write("msg.attach/attachments/Outlook.png", "alpha");
await boxR.write("msg.attach/attachments/img/inline.jpg", "beta");
await boxR.write("msg.attach/photo-001.attach/photo-001.jpg", "gamma");
const r = await scanAttachScope({ absPath: boxR.path("msg.attach"), relPath: "msg.attach" });
print(`claimed: ${r.claimed.toSorted().join(", ")}`);
print(`errors: ${r.errors.length}`)
=>
claimed: attachments/Outlook.png, attachments/img/inline.jpg
errors: 0
```

The nested `.attach/` scope is left to its own scan — not picked up here.

```cleanup
await boxR.cleanup();
```

## scanBoxAttachments walks the whole box

Combined "find scopes + scan each" — what the pre-commit hook calls.

```
const box10 = await makeTmpBox();
await box10.write("box/inbox/scan-1.attach/photo-001.jpg", "abc");
await box10.write("box/inbox/scan-2.attach/photo-001.jpg", "def");
const summary = await scanBoxAttachments(box10.root);
print(`scope count: ${summary.scopes.length}`);
print(`total claimed: ${summary.scopes.reduce((n, s) => n + s.claimed.length, 0)}`);
print(`errors: ${summary.errors.length}`)
=>
scope count: 2
total claimed: 2
errors: 0
```

```cleanup
await box10.cleanup();
```

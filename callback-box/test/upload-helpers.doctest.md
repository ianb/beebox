# Upload Helpers

Helpers for the `upload` command: content-hash dedup ledger and streaming
SHA-256.

```ts setup
import {
  emptyLedger,
  findEntry,
  addEntry,
  loadLedger,
  saveLedger,
  sha256File,
  groupScanFiles,
  LEDGER_REL_PATH,
  type UploadLedgerEntry,
} from "../src/core/commands/upload-helpers.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

function entry(hash: string, opts: Partial<UploadLedgerEntry> = {}): UploadLedgerEntry {
  return {
    hash,
    originalName: `${hash.slice(0, 6)}.pdf`,
    originalPath: `/tmp/${hash.slice(0, 6)}.pdf`,
    uploadedAt: "2026-04-29T03:20:00.000Z",
    kind: "scan",
    ...opts,
  };
}

async function caught<T>(fn: () => Promise<T>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}
```

## Empty ledger shape

```
JSON.stringify(emptyLedger())
=> {"version":1,"entries":[]}
```

## addEntry and findEntry

```
const l = emptyLedger();
addEntry(l, entry("aaa"));
addEntry(l, entry("bbb", { sessionRelDir: "box/inbox/scan-x" }));
print(`count=${l.entries.length}`);
print(`found bbb session: ${findEntry(l, "bbb")!.sessionRelDir}`);
print(`found ccc: ${findEntry(l, "ccc") === undefined}`)
=>
count=2
found bbb session: box/inbox/scan-x
found ccc: true
```

## Ledger location is per-box

```
LEDGER_REL_PATH
=> .callback-box/uploads.json
```

## loadLedger returns empty when the file is absent

```
const box = await makeTmpBox();
const l = await loadLedger(box.root);
JSON.stringify(l)
=> {"version":1,"entries":[]}
```

```cleanup
await box.cleanup();
```

## Roundtrip save then load

```
const box2 = await makeTmpBox();
const l2 = emptyLedger();
addEntry(l2, entry("deadbeef", { kind: "scan", sessionRelDir: "box/inbox/scan-y" }));
await saveLedger(box2.root, l2);
const reloaded = await loadLedger(box2.root);
print(`entries=${reloaded.entries.length}`);
print(`hash=${reloaded.entries[0].hash}`);
print(`session=${reloaded.entries[0].sessionRelDir}`)
=>
entries=1
hash=deadbeef
session=box/inbox/scan-y
```

```cleanup
await box2.cleanup();
```

## Bad ledger format is rejected loudly

If somebody hand-edits the file into something other than the expected shape,
we'd rather error than silently treat the box as never having uploaded
anything (which would re-import everything).

```
const box3 = await makeTmpBox();
await box3.write(LEDGER_REL_PATH, JSON.stringify({ version: 999, entries: [] }));
const err = await caught(() => loadLedger(box3.root));
err !== null && err.message.includes("not in the expected format")
=> true
```

```cleanup
await box3.cleanup();
```

## sha256File computes a known digest

The SHA-256 of the three-byte string `abc` is documented in FIPS 180-4.

```
const box4 = await makeTmpBox();
await box4.write("sample.txt", "abc");
await sha256File(box4.path("sample.txt"))
=> ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

```cleanup
await box4.cleanup();
```

## groupScanFiles: scanner-prefix grouping

JPEGs from a flatbed scanner come out as `<prefix>_NNN.jpg`. We group by
prefix so a single upload invocation produces one session per scanner run.

```
const groups = groupScanFiles([
  "/in/Scan2026-04-29_153807_000.jpg",
  "/in/Scan2026-04-29_153807_001.jpg",
  "/in/Scan2026-04-29_154704_000.jpg",
  "/in/Scan2026-04-29_154704_001.jpg",
  "/in/Scan2026-04-29_154704_002.jpg",
]);
groups.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
=> image-batch:Scan2026-04-29_153807=2 | image-batch:Scan2026-04-29_154704=3
```

## groupScanFiles: each PDF is its own group

```
const groups2 = groupScanFiles([
  "/in/letter.pdf",
  "/in/will.pdf",
  "/in/photos_000.jpg",
  "/in/photos_001.jpg",
]);
groups2.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
=> pdf:letter=1 | pdf:will=1 | image-batch:photos=2
```

## groupScanFiles: unmatched images bundle together

Image filenames without a `_NNN.ext` tail (no underscore-digits suffix) bundle
into one fallback group — the caller's invocation defines the batch.

```
const groups3 = groupScanFiles([
  "/in/holiday.jpg",
  "/in/random.png",
  "/in/Scan2026-04-29_154947_000.jpg",
  "/in/Scan2026-04-29_154947_001.jpg",
]);
groups3.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
=> image-batch:Scan2026-04-29_154947=2 | image-batch:(loose images)=2
```

A single image with a scanner-like name (`IMG_0042.jpg`, etc.) gets its own
matched group, even if it's just one file. The pattern is broad on purpose:
single-file groups still work fine downstream.

```
const groups4 = groupScanFiles(["/in/IMG_0042.jpg", "/in/IMG_0043.jpg"]);
groups4.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
=> image-batch:IMG=2
```

The separator before the digit suffix can be either `_` or `-` —
`photo-0001.jpg` clusters by the `photo` prefix the same way
`Scan_001.jpg` clusters by `Scan`.

```
const groups5 = groupScanFiles([
  "/in/photo-0001.jpg",
  "/in/photo-0002.jpg",
  "/in/photo-0003.jpg",
]);
groups5.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
=> image-batch:photo=3
```

## groupScanFiles: rejects unsupported types

```
const err = await caught(async () => groupScanFiles(["/in/notes.txt"]));
err !== null && err.message.startsWith("Unsupported file type(s):")
=> true
```

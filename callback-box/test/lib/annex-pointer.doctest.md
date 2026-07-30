# annexPointer

Detects and parses git-annex pointer files — the short text stand-in a
working tree holds when an annexed file's content is not present. See
`src/lib/annex-pointer.ts`.

Two situations produce a pointer and they look identical on disk: content that
was never fetched, and a checkout made without git-annex installed. Both mean
"these are not the bytes you asked for", so one predicate serves the annex
doctor and every content read path.

```ts setup
import { isAnnexPointer, parseAnnexPointer, describeAbsentContent } from "../../src/lib/annex-pointer.js";

/** Encode text as the bytes a reader would get off disk. */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A real pointer, verbatim from a git-annex 10.20260717 repo. */
const POINTER =
  "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n";
```

A pointer parses into its key, expected size, and expected hash — all three
carried in the key itself, so a caller can say what the content *should* be
without fetching it:

```ts
const p = parseAnnexPointer(bytes(POINTER));
p?.size
=> 300000

p?.sha256
=> 2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92

p?.key
=> SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg
```

The trailing newline is optional, and an extensionless key (a file with no
suffix, as bulk upload can produce) parses the same way:

```ts
isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "a".repeat(64) + ".jpg"))
=> true

isAnnexPointer(bytes("/annex/objects/SHA256-s12--" + "b".repeat(64)))
=> true
```

Ordinary content is rejected. The binary case matters most: a real JPEG must
never be mistaken for a pointer, and it is rejected on the UTF-8 decode
without inspecting its structure.

```ts
isAnnexPointer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))
=> false

isAnnexPointer(bytes("a normal card body\n"))
=> false

isAnnexPointer(new Uint8Array([]))
=> false
```

Near-misses fail closed rather than half-parsing. A path that merely *starts*
like a pointer, a key whose hash is the wrong length, and a non-hex digest are
all ordinary content as far as a reader is concerned:

```ts
isAnnexPointer(bytes("/annex/objects/nonsense"))
=> false

isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "a".repeat(63) + ".jpg"))
=> false

isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "z".repeat(64)))
=> false

isAnnexPointer(bytes("/annex/objects/WORM-s12-m456--file.jpg"))
=> false
```

That last one is deliberate: a `WORM` key carries no content hash, so there is
nothing trustworthy to report about it — better to treat it as unrecognized
than to invent a half-populated result.

A file too large to be a pointer is rejected without being decoded, so
`isAnnexPointer` stays cheap on real content:

```ts
isAnnexPointer(bytes("/annex/objects/SHA256E-s12--" + "a".repeat(64) + ".jpg" + " ".repeat(2000)))
=> false
```

The absent-content message names the remedy, because the reader is usually an
agent deciding what to do next:

```ts
const ptr = parseAnnexPointer(bytes(POINTER));
ptr === null ? "unparsed" : describeAbsentContent(ptr, "photos.attach/photo-001.jpg")
=> photos.attach/photo-001.jpg: content not present locally (300000 bytes, sha256 2ee2c7d49384…). Fetch it with `git annex get photos.attach/photo-001.jpg`.
```

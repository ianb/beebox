# Reading asset content that might not be here

Under git-annex an asset's working-tree file holds either the bytes or a
~100-byte pointer standing in for them. Every reader has to tell those apart.
See `src/lib/asset-content.ts`.

The failure mode of not doing so is silent: a pointer served with
`Content-Type: image/jpeg`, or 101 bytes of text shipped to a transcription API
as if it were audio. There are six independent readers and they share no
boundary, so this is one predicate rather than six fixes.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { probePointer, readAssetContent } from "../../src/lib/asset-content.js";

const POINTER =
  "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n";
```

A file holding a pointer is reported with the size and hash the content
*should* have, so a caller can say something specific rather than "missing":

```ts
const box = await makeTmpBox();
await box.write("n.attach/photo.jpg", POINTER);
const p = await probePointer(box.path("n.attach/photo.jpg"));
`${p?.size} ${p?.sha256.slice(0, 12)}`
=> 300000 2ee2c7d49384
```

Real content probes as null — it is content, not a pointer:

```ts continue
await fs.writeFile(box.path("n.attach/real.jpg"), Buffer.alloc(5000, 9));
await probePointer(box.path("n.attach/real.jpg"))
=> null
```

`knownSize` short-circuits without reading. A caller that already `stat`ed —
the common case in a route that needs the size for `Content-Length` anyway —
pays nothing for files too large to be a pointer:

```ts continue
await probePointer(box.path("n.attach/real.jpg"), { knownSize: 5000 })
=> null
```

A missing file probes as null rather than throwing. "Not there at all" is a
different condition with its own handling (a 404), and conflating the two would
make both harder to report accurately:

```ts continue
await probePointer(box.path("n.attach/gone.jpg"))
=> null
```

`readAssetContent` is for callers that just want bytes. It branches on the one
distinction that matters:

```ts continue
const absent = await readAssetContent(box.path("n.attach/photo.jpg"));
absent.ok
=> false

absent.ok ? "" : absent.error.kind
=> not-present

const present = await readAssetContent(box.path("n.attach/real.jpg"));
present.ok ? present.value.length : -1
=> 5000
```

Other failures throw rather than becoming a Result arm — a missing file is an
infrastructure error the existing boundary handlers already catch, and
laundering it here would blur the distinction this type exists to draw:

```ts continue
const thrown = await readAssetContent(box.path("n.attach/gone.jpg")).then(
  () => "returned a Result",
  (e: unknown) => (e instanceof Error ? e.message.slice(0, 6) : "non-error"),
);
thrown
=> ENOENT
```

```ts cleanup
await box.cleanup();
```

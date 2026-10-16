# file-readable: tell a file that can't be read from a failed upload

A picked `File` is a handle on the disk. If the file is moved or deleted
after the pick, every read fails, and an upload of it fails inside the
transfer as a "network error". `assertReadable` reads the first chunk first
so the caller can say what actually happened.

```ts setup
import { assertReadable, UnreadableFileError } from "../../src/lib/file-readable.js";
```

A readable blob passes, and so does an empty one:

```ts
await assertReadable(new Blob(["photo bytes"]), { name: "shelf.jpg" });
await assertReadable(new Blob([]), { name: "empty.txt" });
"ok"
=> ok
```

A blob whose stream errors on read, the way a deleted file's does in a
browser (even when the browser reports its size as 0), is unreadable:

```ts
const gone = {
  stream: () => new ReadableStream({ pull(c) { c.error(new TypeError("network error")); } }),
} as unknown as Blob;
let caught: unknown;
try { await assertReadable(gone, { name: "shelf.jpg" }); } catch (e) { caught = e; }
[caught instanceof UnreadableFileError, (caught as Error).message]
=> [
  true,
  "shelf.jpg can't be read. It may have been moved or deleted since it was picked."
]
```

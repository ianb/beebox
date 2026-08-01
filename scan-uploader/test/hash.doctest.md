# Streaming SHA-256

The wire contract fixes SHA-256, lowercase hex, as the hash algorithm used
for the PUT path segment, the check key, and the server's dedup key.
`sha256File` streams the file rather than reading it whole, since scans can
be tens of megabytes.

```ts setup
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256File } from "../src/hash.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("hash");
```

A known test vector: SHA-256 of the empty string.

```
const emptyFile = join(dir, "empty.bin");
await writeFile(emptyFile, Buffer.alloc(0));
await sha256File(emptyFile)
=> e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

And of the ASCII string `abc` (the standard SHA-256 test vector):

```
const abcFile = join(dir, "abc.bin");
await writeFile(abcFile, "abc");
await sha256File(abcFile)
=> ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

A larger, non-trivial file hashes consistently across repeated reads (the
property the settle gate depends on: unchanged bytes always hash the same):

```
const bigFile = join(dir, "big.bin");
await writeFile(bigFile, Buffer.alloc(5 * 1024 * 1024, 7));
const first = await sha256File(bigFile);
const second = await sha256File(bigFile);
first === second
=> true
```

```cleanup
await removeTmpDir(dir);
```

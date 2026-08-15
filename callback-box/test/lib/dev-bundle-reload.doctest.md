# Development bundle replacement identity

The dev launcher stamps the exact bundle artifact it loaded. Long-lived
processes compare identity rather than ordering, so replacing a bundle with an
older timestamp is still detected, while packed/prod processes without a stamp
remain opted out.

```ts setup
import { abandonDevBundleDrain, beginDevBundleDrain, devBundleWasReplaced, isDevBundleDraining } from "../../src/lib/dev-bundle-reload.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-bundle-reload-"));
const bundle = path.join(dir, "cli.mjs");
await fs.writeFile(bundle, "first");
const first = await fs.stat(bundle, { bigint: true });
process.env.CB_DEV_BUNDLE_PATH = bundle;
process.env.CB_DEV_BUNDLE_ID = `${first.dev}:${first.ino}:${first.size}:${first.mtimeNs}`;
```

```ts
await devBundleWasReplaced()
=> false
```

Atomic replacement changes inode/size even if its mtime is forced backward:

```ts
const replacement = path.join(dir, "replacement.mjs");
await fs.writeFile(replacement, "older replacement");
await fs.utimes(replacement, new Date(0), new Date(0));
await fs.rename(replacement, bundle);
await devBundleWasReplaced()
=> true
```

An unsafe/stuck drain can reopen writes while suppressing repeated attempts for
the same replacement artifact. A later build identity remains eligible.

```ts
beginDevBundleDrain();
await abandonDevBundleDrain();
JSON.stringify({ draining: isDevBundleDraining(), replaced: await devBundleWasReplaced() })
=> {"draining":false,"replaced":false}
```

```ts cleanup
delete process.env.CB_DEV_BUNDLE_PATH;
delete process.env.CB_DEV_BUNDLE_ID;
await fs.rm(dir, { recursive: true });
```

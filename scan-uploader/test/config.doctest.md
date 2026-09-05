# Config loading and validation

The uploader fails closed on any config problem, with a message naming
exactly what's wrong — there's no silent partial-config fallback.

```ts setup
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "../src/config.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("config");

async function writeConfig(contents: unknown): Promise<string> {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(contents));
  return path;
}

// checkThrows only catches synchronous throws; loadConfig rejects, so
// doctests assert on the rejected error's name via this helper instead.
async function rejectedErrorName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(no error thrown)";
  } catch (e) {
    return e instanceof Error ? e.name : String(e);
  }
}
```

A well-formed config with one target loads cleanly; an omitted `disposition`
defaults to `keep`:

```
const path = await writeConfig({
  targets: [{ folder: "/scans/family", serverUrl: "https://beebox.run", box: "family", tokenPath: "/secrets/family.token" }],
});
const config = await loadConfig(path);
JSON.stringify(config, null, 2)
=>
{
  "targets": [
    {
      "folder": "/scans/family",
      "serverUrl": "https://beebox.run",
      "box": "family",
      "tokenPath": "/secrets/family.token",
      "disposition": "keep"
    }
  ]
}
```

A missing file is a `ConfigError`, not a raw `fs` error:

```
await rejectedErrorName(loadConfig(join(dir, "does-not-exist.json")))
=> ConfigError
```

Invalid JSON:

```
const badJson = join(dir, "bad.json");
await writeFile(badJson, "{ not json");
await rejectedErrorName(loadConfig(badJson))
=> ConfigError
```

An empty `targets` array is rejected — there's no such thing as a config
that does nothing:

```
const emptyTargets = await writeConfig({ targets: [] });
await rejectedErrorName(loadConfig(emptyTargets))
=> ConfigError
```

A target missing a required field is rejected:

```
const missingBox = await writeConfig({
  targets: [{ folder: "/scans", serverUrl: "https://beebox.run", tokenPath: "/t" }],
});
await rejectedErrorName(loadConfig(missingBox))
=> ConfigError
```

An invalid `serverUrl` (not a URL) is rejected:

```
const badUrl = await writeConfig({
  targets: [{ folder: "/scans", serverUrl: "not-a-url", box: "family", tokenPath: "/t" }],
});
await rejectedErrorName(loadConfig(badUrl))
=> ConfigError
```

An unrecognized `disposition` value is rejected:

```
const badDisposition = await writeConfig({
  targets: [{ folder: "/scans", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "delete" }],
});
await rejectedErrorName(loadConfig(badDisposition))
=> ConfigError
```

`disposition: "trash"` is accepted on a platform reported as `darwin`:

```
const trashOnMac = await writeConfig({
  targets: [{ folder: "/scans", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "trash" }],
});
const macConfig = await loadConfig(trashOnMac, { platform: "darwin" });
macConfig.targets[0].disposition
=> trash
```

`disposition: "trash"` REFUSES at config load on a non-macOS platform — the
uploader never falls back to `unlink`, so a Trash disposition that can't be
honored must be caught before any file ever moves:

```continue
await rejectedErrorName(loadConfig(trashOnMac, { platform: "linux" }))
=> ConfigError
```

```cleanup
await removeTmpDir(dir);
```

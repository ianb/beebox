# Default config path resolution

`resolveConfigPath` (`src/config-path.ts`) is the single resolver shared by
the bare run, `configure`'s `--config` default, and `schedule install`'s
`--config` default (one resolver, one way to do it) — an explicit
`--config <path>` never goes through this module at all. Order:
`./scan-uploader.json` relative to the caller's cwd if it exists, else
`~/.config/scan-uploader.json` — even if that one doesn't exist either
(the caller decides what "doesn't exist" means: a write creates it fresh, a
read reports it missing).

```ts setup
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { configure } from "../src/configure.js";
import {
  MISSING_CONFIG_MESSAGE,
  cwdConfigPath,
  homeConfigPath,
  pathExists,
  resolveConfigPath,
} from "../src/config-path.js";
import { startFakeScanServer, type FakeScanServer } from "./fake-scan-server.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("config-path");
```

## When the cwd candidate exists, it wins over `~/.config`

```
const cwdDirA = join(dir, "cwd-wins");
await mkdir(cwdDirA, { recursive: true });
await writeFile(cwdConfigPath(cwdDirA), "{}");
const homeDirA = join(dir, "home-unused");
const resolvedA = await resolveConfigPath({ cwd: cwdDirA, homeDir: homeDirA });
resolvedA === cwdConfigPath(cwdDirA)
=> true
```

The `~/.config` candidate is never even checked in this case — nothing was
created there:

```continue
await pathExists(homeConfigPath(homeDirA))
=> false
```

## When the cwd candidate doesn't exist, `~/.config/scan-uploader.json` is used — whether or not IT exists either

```
const cwdDirB = join(dir, "cwd-empty");
await mkdir(cwdDirB, { recursive: true });
const homeDirB = join(dir, "home-b");
const resolvedB = await resolveConfigPath({ cwd: cwdDirB, homeDir: homeDirB });
resolvedB === homeConfigPath(homeDirB)
=> true
```

```continue
await pathExists(resolvedB)
=> false
```

An existing `~/.config/scan-uploader.json` is used the same way (this is
the "update an existing default config" case — resolution doesn't care
whether the target exists, only the caller does):

```continue
const homeDirC = join(dir, "home-c");
await mkdir(join(homeDirC, ".config"), { recursive: true });
await writeFile(homeConfigPath(homeDirC), "{}");
const cwdDirC = join(dir, "cwd-empty-c");
await mkdir(cwdDirC, { recursive: true });
const resolvedC = await resolveConfigPath({ cwd: cwdDirC, homeDir: homeDirC });
resolvedC === homeConfigPath(homeDirC)
=> true
```

## `configure` given the resolved default creates `~/.config/scan-uploader.json` from scratch

Mirrors what `configure-cli.ts` actually does when `--config` is omitted:
resolve first, then hand the result to `configure()` as an explicit path —
`configure()` itself has no resolution logic of its own.

```
const cwdDirD = join(dir, "cwd-for-configure");
await mkdir(cwdDirD, { recursive: true });
const homeDirD = join(dir, "home-d");
const resolvedForWrite = await resolveConfigPath({ cwd: cwdDirD, homeDir: homeDirD });
resolvedForWrite === homeConfigPath(homeDirD)
=> true
```

```continue
const serverD: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const resultD = await configure({
  serverUrlWithBox: `${serverD.url}/family`,
  folder: "/scans/family",
  disposition: "keep",
  name: "laptop",
  token: "secret",
  configPath: resolvedForWrite,
  homeDir: homeDirD,
});
resultD.configPath === homeConfigPath(homeDirD)
=> true
```

```continue
const writtenD = JSON.parse(await readFile(homeConfigPath(homeDirD), "utf-8"));
writtenD.targets.length
=> 1
```

```continue
writtenD.targets[0].box
=> family
```

```cleanup
await serverD.close();
```

## The friendly missing-config message

Printed by the bare run when NEITHER resolution candidate exists (a config
that exists but fails to parse/validate keeps its own, unrelated
`ConfigError` message — this text is only for the does-not-exist case).

```
MISSING_CONFIG_MESSAGE.length
=> 3
```

```continue
MISSING_CONFIG_MESSAGE.join("\n")
=>
No config found (looked for ./scan-uploader.json and ~/.config/scan-uploader.json).
Set up a target with: scan-uploader configure <server-url-with-box> --folder <path>
(mint a token first in the box's Settings -> Scan uploaders)
```

```cleanup
await removeTmpDir(dir);
```

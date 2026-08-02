# The `configure` subcommand's core logic

Exercises `configure()` (`src/configure.ts`) directly — argv parsing and
interactive TTY prompting live in `src/configure-cli.ts` and aren't
exercised here (the TTY-prompt path isn't practical to doctest: it needs a
real TTY; the non-TTY `requireFolderFlag` fail-closed path below covers the
same logic `configure-cli.ts` actually depends on).

```ts setup
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { configure } from "../src/configure.js";
import { parseConfigureArgs, requireFolderFlag } from "../src/configure-cli.js";
import { parseServerUrlWithBox } from "../src/target-url.js";
import { startFakeScanServer, type FakeScanServer } from "./fake-scan-server.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("configure");

interface Rejection {
  readonly name: string;
  readonly message: string;
}

async function rejected(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
    return { name: "(no error thrown)", message: "(no error thrown)" };
  } catch (e) {
    return {
      name: e instanceof Error ? e.name : String(e),
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function syncRejected(fn: () => unknown): Promise<Rejection> {
  return rejected(Promise.resolve().then(fn));
}

function permOctal(mode: number): string {
  return (mode & 0o777).toString(8);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
```

## Happy path — config created from scratch, token file written 0600

No `scan-uploader.json` exists yet at this path, so the writer starts from
`{ "targets": [] }`; the verification `check` succeeds against the fake
server.

```
const homeDir1 = join(dir, "home1");
const configPath1 = join(dir, "fresh", "scan-uploader.json");
const server1: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const result1 = await configure({
  serverUrlWithBox: `${server1.url}/family`,
  folder: "/scans/family",
  disposition: "archive",
  name: "laptop-1",
  token: "secret-token-1",
  configPath: configPath1,
  homeDir: homeDir1,
});
result1.box
=> family
```

```continue
result1.name
=> laptop-1
```

```continue
result1.tokenPath === join(homeDir1, ".scan-tokens", "family.token")
=> true
```

The config file was created with exactly the real values — no placeholders:

```continue
const configContents1 = JSON.parse(await readFile(configPath1, "utf-8"));
configContents1.targets.length
=> 1
```

```continue
configContents1.targets[0].folder
=> /scans/family
```

```continue
configContents1.targets[0].disposition
=> archive
```

```continue
configContents1.targets[0].serverUrl === server1.url
=> true
```

```continue
configContents1.targets[0].tokenPath === result1.tokenPath
=> true
```

The token file is 0600, its parent directory 0700, and the token content is
exactly what was passed in (trimmed):

```continue
const tokenStat1 = await stat(result1.tokenPath);
permOctal(tokenStat1.mode)
=> 600
```

```continue
const tokenDirStat1 = await stat(join(homeDir1, ".scan-tokens"));
permOctal(tokenDirStat1.mode)
=> 700
```

```continue
(await readFile(result1.tokenPath, "utf-8")).trim()
=> secret-token-1
```

Verification only ever hits `check` — no PUT is sent:

```continue
server1.putRequests.length
=> 0
```

```cleanup
await server1.close();
```

## Unknown keys survive — update-in-place and append both preserve them

Pre-seed a config with a top-level unknown key and a per-target unknown key.
Running `configure` for the SAME box + serverUrl updates that target
in place (folder/disposition change, unknown keys survive); running it again
for a DIFFERENT box appends a second target and leaves the first untouched.

```
const server2: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const configPath2 = join(dir, "preseeded", "scan-uploader.json");
await mkdir(join(dir, "preseeded"), { recursive: true });
await writeFile(
  configPath2,
  JSON.stringify(
    {
      targets: [
        {
          folder: "/old/folder",
          serverUrl: server2.url,
          box: "family",
          tokenPath: "/old/token/path",
          disposition: "keep",
          note: "hand-added per-target field",
        },
      ],
      futureFeature: { nested: true },
    },
    null,
    2,
  ),
);
const result2 = await configure({
  serverUrlWithBox: `${server2.url}/family`,
  folder: "/scans/updated",
  disposition: "archive",
  name: "laptop-2",
  token: "secret-token-2",
  configPath: configPath2,
  homeDir: join(dir, "home2"),
});
const configContents2 = JSON.parse(await readFile(configPath2, "utf-8"));
configContents2.targets.length
=> 1
```

```continue
configContents2.targets[0].folder
=> /scans/updated
```

```continue
configContents2.targets[0].disposition
=> archive
```

```continue
configContents2.targets[0].note
=> hand-added per-target field
```

```continue
JSON.stringify(configContents2.futureFeature)
=> {"nested":true}
```

```continue
configContents2.targets[0].tokenPath === result2.tokenPath
=> true
```

A second `configure` call for a different box appends rather than
overwriting, and the first target (with its unknown key) is untouched:

```continue
const result2b = await configure({
  serverUrlWithBox: `${server2.url}/second`,
  folder: "/scans/second",
  disposition: "keep",
  name: "laptop-2b",
  token: "secret-token-2b",
  configPath: configPath2,
  homeDir: join(dir, "home2b"),
});
const configContents2b = JSON.parse(await readFile(configPath2, "utf-8"));
configContents2b.targets.length
=> 2
```

```continue
configContents2b.targets[0].note
=> hand-added per-target field
```

```continue
configContents2b.targets[1].box
=> second
```

```continue
configContents2b.targets[1].folder
=> /scans/second
```

```cleanup
await server2.close();
```

## An unparseable existing config is refused, untouched

```
const server3: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const badConfigPath = join(dir, "bad", "scan-uploader.json");
await mkdir(join(dir, "bad"), { recursive: true });
await writeFile(badConfigPath, "{ not json");
const failure3 = await rejected(
  configure({
    serverUrlWithBox: `${server3.url}/family`,
    folder: "/scans/family",
    disposition: "keep",
    name: "x",
    token: "t",
    configPath: badConfigPath,
    homeDir: join(dir, "home3"),
  }),
);
failure3.name
=> ConfigError
```

The file is byte-for-byte untouched:

```continue
await readFile(badConfigPath, "utf-8")
=> { not json
```

```cleanup
await server3.close();
```

## Slug validation rejects path tricks before any filesystem use

The token path is derived only from the box slug parsed out of
`<server-url-with-box>`, and that slug is validated against a conservative
pattern before it becomes a filename component. An encoded-slash traversal
attempt in the URL path never matches the pattern:

```
const badSlug = await syncRejected(() => parseServerUrlWithBox("https://cb.example.org/..%2f..%2fetc%2fpasswd"));
badSlug.name
=> ConfigureError
```

```continue
badSlug.message
=> box slug "..%2f..%2fetc%2fpasswd" is invalid — must match ^[\da-z][\da-z-]{0,63}$
```

The box is the LAST path segment; a mount prefix before it (the dev
router's `/<worktree>/<box>` shape) stays part of the server URL rather
than being silently dropped:

```continue
const nested = parseServerUrlWithBox("http://localhost:3210/my-worktree/test1");
[nested.serverUrl, nested.box].join(" ")
=> http://localhost:3210/my-worktree test1
```

```continue
const bare = parseServerUrlWithBox("https://cb.example.org/family");
[bare.serverUrl, bare.box].join(" ")
=> https://cb.example.org family
```

And `configure()` itself refuses before writing anything — the bad slug is
rejected during URL parsing, ahead of any config or token write:

```continue
const configPath4 = join(dir, "slug-test", "scan-uploader.json");
const failure4 = await rejected(
  configure({
    serverUrlWithBox: "https://cb.example.org/..%2f..%2fetc%2fpasswd",
    folder: "/scans/x",
    disposition: "keep",
    name: "x",
    token: "t",
    configPath: configPath4,
    homeDir: join(dir, "home4"),
  }),
);
failure4.name
=> ConfigureError
```

```continue
await exists(configPath4)
=> false
```

## Non-TTY with a missing `--folder` fails closed, naming the flag

```
const missingFolder = await syncRejected(() => requireFolderFlag(undefined));
missingFolder.name
=> ConfigureError
```

```continue
missingFolder.message
=> missing required flag: --folder
```

A folder that IS present just passes through:

```continue
requireFolderFlag("/scans/present")
=> /scans/present
```

An empty `--folder ""` is rejected the same way — not silently accepted as
a placeholder:

```continue
const emptyFolder = await syncRejected(() => requireFolderFlag(""));
emptyFolder.message
=> --folder must not be empty
```

A flag with a missing value that happens to be followed by another flag is
never silently treated as that flag's value — `--folder --config x` must
fail closed on `--folder`, not quietly write to the wrong config path:

```continue
const looksLikeAFlag = await syncRejected(() =>
  parseConfigureArgs(["https://cb.example.org/family", "--folder", "--config", "/tmp/x.json"]),
);
looksLikeAFlag.message
=> --folder requires a value
```

## A bad new target never corrupts an already-valid config on disk

`configure()` itself doesn't pre-check `folder` (that's `configure-cli.ts`'s
job via `requireFolderFlag`) — so this exercises the writer's OWN
belt-and-suspenders guard: the candidate document is validated with the
strict reader's rules BEFORE the atomic write, so a target the reader would
reject (here: an empty `folder`) never overwrites a config that was valid
before this call.

```
const configPath5 = join(dir, "corruption-guard", "scan-uploader.json");
await mkdir(join(dir, "corruption-guard"), { recursive: true });
const goodConfig5 = { targets: [{ folder: "/scans/good", serverUrl: "https://good.example.org", box: "good", tokenPath: "/t", disposition: "keep" }] };
await writeFile(configPath5, JSON.stringify(goodConfig5, null, 2));
const server5: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
});
const failure5 = await rejected(
  configure({
    serverUrlWithBox: `${server5.url}/newbox`,
    folder: "",
    disposition: "keep",
    name: "x",
    token: "t",
    configPath: configPath5,
    homeDir: join(dir, "home5"),
  }),
);
failure5.name
=> ConfigError
```

```continue
JSON.parse(await readFile(configPath5, "utf-8")).targets.length
=> 1
```

```continue
JSON.parse(await readFile(configPath5, "utf-8")).targets[0].box
=> good
```

```cleanup
await server5.close();
```

## A bad token fails verification — files are left in place, both paths named

```
const server6: FakeScanServer = await startFakeScanServer({
  checkState: () => ({ state: "unknown" }),
  putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
  checkAuthorization: (authorization) => authorization === "Bearer good-token",
});
const configPath6 = join(dir, "verify-fail", "scan-uploader.json");
const homeDir6 = join(dir, "home6");
const failure6 = await rejected(
  configure({
    serverUrlWithBox: `${server6.url}/family`,
    folder: "/scans/family",
    disposition: "keep",
    name: "laptop-6",
    token: "wrong-token",
    configPath: configPath6,
    homeDir: homeDir6,
  }),
);
failure6.name
=> ConfigureError
```

```continue
failure6.message.includes("HTTP 401")
=> true
```

```continue
failure6.message.includes(configPath6)
=> true
```

```continue
const tokenPath6 = join(homeDir6, ".scan-tokens", "family.token");
failure6.message.includes(tokenPath6)
=> true
```

Both files were actually written, not just named in the message:

```continue
await exists(configPath6)
=> true
```

```continue
await exists(tokenPath6)
=> true
```

```continue
(await readFile(tokenPath6, "utf-8")).trim()
=> wrong-token
```

```cleanup
await server6.close();
await removeTmpDir(dir);
```

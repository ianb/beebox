# The `cb` Tombstone

`cb` is the pre-rename name of `bbx`. Stale agent context, old transcripts, and
old scripts still call it, so `bin/cb` exists to answer them — with a message
that names the new command, a nonzero exit, and no work done.

Both halves of that contract matter. The message is what lets a caller correct
itself; the refusal to forward is what makes the rename finish, since a `cb`
that quietly ran `bbx` would keep every stale caller working forever.

```ts setup
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tombstone = path.resolve(fileURLToPath(import.meta.url), "../../../bin/cb");

/** Run `cb` with the given args; it never succeeds, so failure is the result. */
async function runCb(...args: string[]) {
  try {
    await execFileAsync(tombstone, args);
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
```

## Every invocation fails the same way

No arguments, `--help`, and an attempted subcommand are indistinguishable —
there is no input that makes this command do work.

```ts
const runs = await Promise.all([runCb(), runCb("--help"), runCb("status")]);
runs.map((r) => r.code)
=> [
  1,
  1,
  1
]

new Set(runs.map((r) => r.stderr)).size
=> 1
```

The message names the rename and where to go, on stderr, and nothing is written
to stdout for a caller to mistake for output:

```ts continue
const [bare] = runs;
bare.stderr.includes("renamed to bbx")
=> true

bare.stderr.includes("bbx --help")
=> true

bare.stdout.length
=> 0
```

## It never performs the requested operation

`cb status` would be a real `bbx` subcommand. Nothing runs it: the tombstone is
a fixed-output script with no reference to `bbx` as an executable, so there is
no path by which an old call reaches the CLI.

```ts continue
const source = await fs.readFile(tombstone, "utf-8");
/^\s*(exec\s+)?(\S*\/)?bbx\b/m.test(source)
=> false
```

## It ships everywhere `bbx` does

The package `bin` map carries it, so an installed dependency gets `cb` on the
same path as `bbx` (`bin/` is already in the `files` allowlist).

```ts continue
const pkg = JSON.parse(
  await fs.readFile(path.resolve(tombstone, "../../package.json"), "utf-8"),
);
pkg.bin
=> {
  "bbx": "./bin/bbx",
  "cb": "./bin/cb"
}
```

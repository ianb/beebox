# Dispositions

`keep`/`archive`/`trash`, applied only after `run-target.ts`'s
restat-before-disposition check has already passed. Never `unlink`:
`archive` renames into `<folder>/imported/`, and `trash` always goes through
an external Trash mechanism (recoverable), even though these tests fake that
mechanism to stay deterministic and side-effect-free on the machine running
them (invoking the *real* macOS Trash from an automated test would actually
move files on the developer's desktop).

```ts setup
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { applyDisposition } from "../src/disposition.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("disposition");
const originalPath = process.env.PATH ?? "";

// Writes an executable shell script named `name` into `binDir` that appends
// its argv to `logFile` and exits with `exitCode`.
async function writeFakeCommand(params: { binDir: string; name: string; logFile: string; exitCode: number }): Promise<void> {
  const scriptPath = join(params.binDir, params.name);
  await writeFile(
    scriptPath,
    `#!/bin/sh\necho "$@" >> "${params.logFile}"\nexit ${params.exitCode}\n`,
  );
  await chmod(scriptPath, 0o755);
}

async function errorNameFrom(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error thrown)";
  } catch (e) {
    return e instanceof Error ? e.name : String(e);
  }
}
```

## `archive` renames into `imported/`, deduping on a name collision

```
const archiveDir = join(dir, "archive-case");
await mkdir(archiveDir);
const filePath = join(archiveDir, "Doc.pdf");
await writeFile(filePath, "first");
await applyDisposition(filePath, "archive");
(await readdir(join(archiveDir, "imported"))).join(",")
=> Doc.pdf
```

A second file with the same basename gets a numbered suffix instead of
clobbering the first:

```continue
const filePath2 = join(archiveDir, "Doc.pdf");
await writeFile(filePath2, "second");
await applyDisposition(filePath2, "archive");
(await readdir(join(archiveDir, "imported"))).sort().join(",")
=> Doc-2.pdf,Doc.pdf
```

```continue
await readFile(join(archiveDir, "imported", "Doc.pdf"), "utf-8")
=> first
```

```continue
await readFile(join(archiveDir, "imported", "Doc-2.pdf"), "utf-8")
=> second
```

## `trash` invokes the `trash` CLI when it's on PATH

```
const binDir = join(dir, "fake-bin");
await mkdir(binDir);
const logFile = join(binDir, "invocations.log");
await writeFakeCommand({ binDir, name: "trash", logFile, exitCode: 0 });
process.env.PATH = `${binDir}${delimiter}${originalPath}`;

const trashDir = join(dir, "trash-case");
await mkdir(trashDir);
const trashedFile = join(trashDir, "scan.pdf");
await writeFile(trashedFile, "bytes");
await applyDisposition(trashedFile, "trash");
(await readFile(logFile, "utf-8")).trim()
=> «*»/trash-case/scan.pdf
```

A nonzero exit from the `trash` CLI is a real failure, surfaced as
`TrashError` rather than silently falling back to Finder (a present-but-
failing `trash` is a different problem than an absent one):

```continue
const failDir = join(dir, "fake-bin-fail");
await mkdir(failDir);
const failLog = join(failDir, "invocations.log");
await writeFakeCommand({ binDir: failDir, name: "trash", logFile: failLog, exitCode: 1 });
process.env.PATH = `${failDir}${delimiter}${originalPath}`;

const failFile = join(trashDir, "broken.pdf");
await writeFile(failFile, "bytes");
await errorNameFrom(() => applyDisposition(failFile, "trash"))
=> TrashError
```

## `trash` falls back to `osascript` when the `trash` CLI is absent

`PATH` here contains only a directory with a fake `osascript` — no `trash`
anywhere — so the ENOENT from the failed `trash` lookup must trigger the
Finder fallback rather than propagating as a generic spawn error.

```continue
const fallbackDir = join(dir, "fake-bin-fallback");
await mkdir(fallbackDir);
const fallbackLog = join(fallbackDir, "invocations.log");
await writeFakeCommand({ binDir: fallbackDir, name: "osascript", logFile: fallbackLog, exitCode: 0 });
process.env.PATH = fallbackDir;

const noTrashFile = join(trashDir, "no-trash-cli.pdf");
await writeFile(noTrashFile, "bytes");
await applyDisposition(noTrashFile, "trash");
(await readFile(fallbackLog, "utf-8")).includes("no-trash-cli.pdf")
=> true
```

```cleanup
process.env.PATH = originalPath;
await removeTmpDir(dir);
```

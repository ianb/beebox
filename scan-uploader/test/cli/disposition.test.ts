// # Dispositions
//
// `keep`/`archive`/`trash`, applied only after `run-target.ts`'s
// restat-before-disposition check has already passed. Never `unlink`:
// `archive` renames into `<folder>/imported/`, and `trash` always goes through
// an external Trash mechanism (recoverable), even though these tests fake that
// mechanism to stay deterministic and side-effect-free on the machine running
// them (invoking the *real* macOS Trash from an automated test would actually
// move files on the developer's desktop).

import { test } from "tap";
import "agent-doctest/tap";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { applyDisposition } from "../../src/cli/disposition.js";
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

// ## `archive` renames into `imported/`, deduping on a name collision
void test("`archive` renames into `imported/`, deduping on a name collision", async (t) => {
  const archiveDir = join(dir, "archive-case");
  await mkdir(archiveDir);
  const filePath = join(archiveDir, "Doc.pdf");
  await writeFile(filePath, "first");
  await applyDisposition(filePath, "archive");
  t.check(await readdir(join(archiveDir, "imported")), ["Doc.pdf"]);

  // A second file with the same basename gets a numbered suffix instead of
  // clobbering the first:

  const filePath2 = join(archiveDir, "Doc.pdf");
  await writeFile(filePath2, "second");
  await applyDisposition(filePath2, "archive");
  t.check((await readdir(join(archiveDir, "imported"))).toSorted(), ["Doc-2.pdf", "Doc.pdf"]);

  t.check(await readFile(join(archiveDir, "imported", "Doc.pdf"), "utf-8"), "first");

  t.check(await readFile(join(archiveDir, "imported", "Doc-2.pdf"), "utf-8"), "second");
});

// ## `trash` invokes the `trash` CLI when it's on PATH
void test("`trash` invokes the `trash` CLI when it's on PATH", async (t) => {
  t.teardown(async () => {
    try {
      process.env.PATH = originalPath;
      await removeTmpDir(dir);
    } catch (error) {
      t.error(error);
    }
  });
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
  t.check((await readFile(logFile, "utf-8")).trim(), trashedFile);

  // A nonzero exit from the `trash` CLI is a real failure, surfaced as
  // `TrashError` rather than silently falling back to Finder (a present-but-
  // failing `trash` is a different problem than an absent one):

  const failDir = join(dir, "fake-bin-fail");
  await mkdir(failDir);
  const failLog = join(failDir, "invocations.log");
  await writeFakeCommand({ binDir: failDir, name: "trash", logFile: failLog, exitCode: 1 });
  process.env.PATH = `${failDir}${delimiter}${originalPath}`;

  const failFile = join(trashDir, "broken.pdf");
  await writeFile(failFile, "bytes");
  t.check(await errorNameFrom(() => applyDisposition(failFile, "trash")), "TrashError");

  // ## `trash` falls back to `osascript` when the `trash` CLI is absent
  //
  // `PATH` here contains only a directory with a fake `osascript` — no `trash`
  // anywhere — so the ENOENT from the failed `trash` lookup must trigger the
  // Finder fallback rather than propagating as a generic spawn error.

  const fallbackDir = join(dir, "fake-bin-fallback");
  await mkdir(fallbackDir);
  const fallbackLog = join(fallbackDir, "invocations.log");
  await writeFakeCommand({ binDir: fallbackDir, name: "osascript", logFile: fallbackLog, exitCode: 0 });
  process.env.PATH = fallbackDir;

  const noTrashFile = join(trashDir, "no-trash-cli.pdf");
  await writeFile(noTrashFile, "bytes");
  await applyDisposition(noTrashFile, "trash");
  t.check(await readFile(fallbackLog, "utf-8"), `-e tell application "Finder" to delete POSIX file "${noTrashFile}"
`);
});

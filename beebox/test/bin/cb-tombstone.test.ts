// # The `cb` Tombstone
//
// `cb` is the pre-rename name of `bbx`. Stale agent context, old transcripts, and
// old scripts still call it, so `bin/cb` exists to answer them — with a message
// that names the new command, a nonzero exit, and no work done.
//
// Both halves of that contract matter. The message is what lets a caller correct
// itself; the refusal to forward is what makes the rename finish, since a `cb`
// that quietly ran `bbx` would keep every stale caller working forever.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tombstone = path.resolve(import.meta.dirname, "../../bin/cb");

/** Run `cb` with the given args; it never succeeds, so failure is the result. */
async function runCb(...args: string[]) {
  try {
    await execFileAsync(tombstone, args);
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    if (typeof e !== "object" || e === null) throw e;
    const code = "code" in e && typeof e.code === "number" ? e.code : -1;
    const stdout = "stdout" in e && typeof e.stdout === "string" ? e.stdout : "";
    const stderr = "stderr" in e && typeof e.stderr === "string" ? e.stderr : "";
    return { code, stdout, stderr };
  }
}

// ## Every invocation fails the same way
//
// No arguments, `--help`, and an attempted subcommand are indistinguishable —
// there is no input that makes this command do work.
void test("No arguments, --help, and an attempted subcommand are indistinguishable — the...", async (t) => {
  const runs = await Promise.all([runCb(), runCb("--help"), runCb("status")]);
  const stderr = "cb: renamed to bbx. This command does nothing and never forwards.\nUse 'bbx' instead (same subcommands): bbx --help\n";
  t.check(runs, [
    { code: 1, stdout: "", stderr },
    { code: 1, stdout: "", stderr },
    { code: 1, stdout: "", stderr },
  ]);

  // ## It never performs the requested operation
  //
  // `cb status` would be a real `bbx` subcommand. Nothing runs it: the tombstone is
  // a fixed-output script with no reference to `bbx` as an executable, so there is
  // no path by which an old call reaches the CLI.

  const source = await fs.readFile(tombstone, "utf-8");
  t.check(source, not(any(String).matches(/^\s*(exec\s+)?(\S*\/)?bbx\b/m)));

  // ## It ships everywhere `bbx` does
  //
  // The package `bin` map carries it, so an installed dependency gets `cb` on the
  // same path as `bbx` (`bin/` is already in the `files` allowlist).

  const pkg = JSON.parse(
    await fs.readFile(path.resolve(tombstone, "../../package.json"), "utf-8"),
  );
  t.check(pkg.bin, {
    bbx: "./bin/bbx",
    cb: "./bin/cb",
  });
});

// # `fileExists` — the lenient existence probe
//
// True when the path is accessible, false for any failure. Callers use it as
// "is there something here" before creating or reading, so a missing path,
// a missing parent, and a directory must all answer without throwing.
// See `src/lib/file-exists.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileExists, pathExistsStrict } from "../../src/lib/file-exists.js";
import { errnoCode } from "../../src/shared/error-guards.js";

void test("A file and a directory exist; a missing path or parent does not", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-exists-"));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "present.txt"), "x");

  await t.check(fileExists(path.join(dir, "present.txt")), true);
  await t.check(fileExists(dir), true);
  await t.check(fileExists(path.join(dir, "absent.txt")), false);
  await t.check(fileExists(path.join(dir, "absent", "child.txt")), false);
});

// ## `pathExistsStrict`
//
// Only a missing path is "absent"; a broken symlink counts as present unless
// links are followed, and a permission failure throws instead of answering.
void test("pathExistsStrict: missing is false, broken links depend on followLinks, permission errors throw", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-exists-strict-"));
  t.teardown(() => {
    fs.chmodSync(path.join(dir, "locked"), 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.symlinkSync(path.join(dir, "nowhere"), path.join(dir, "dangling"));
  fs.mkdirSync(path.join(dir, "locked"));
  fs.writeFileSync(path.join(dir, "locked", "inside"), "x");
  fs.chmodSync(path.join(dir, "locked"), 0o000);
  await t.check(pathExistsStrict(path.join(dir, "absent"), { followLinks: true }), false);
  await t.check(pathExistsStrict(path.join(dir, "dangling"), { followLinks: false }), true);
  await t.check(pathExistsStrict(path.join(dir, "dangling"), { followLinks: true }), false);
  await t.check(
    pathExistsStrict(path.join(dir, "locked", "inside"), { followLinks: true }).then(() => "answered", (e: unknown) => errnoCode(e)),
    "EACCES",
  );
});

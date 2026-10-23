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
import { fileExists } from "../../src/lib/file-exists.js";

void test("A file and a directory exist; a missing path or parent does not", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-exists-"));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "present.txt"), "x");

  await t.check(fileExists(path.join(dir, "present.txt")), true);
  await t.check(fileExists(dir), true);
  await t.check(fileExists(path.join(dir, "absent.txt")), false);
  await t.check(fileExists(path.join(dir, "absent", "child.txt")), false);
});

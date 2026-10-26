// # The engine docs are readable by every user, and an unreadable copy is "unwritable", not a crash
//
// `ensurePackageDocs` (`src/core/docs-gen/package-docs/core.ts`) builds the
// directory with `mkdtemp`, which is 0700, then opens it: on a unit host
// (docs/plans/per-box-units.md) the deploy's build is read by each box user,
// and a box user's `bbx engine init` must not die on the fingerprint file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePackageDocs } from "../../../src/core/docs-gen/package-docs/core.js";

void test("the written directory is 0755 and its files 0644 whatever the umask; an unreadable one reads as unwritable", async (t) => {
  const packageRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-"));
  const previousUmask = process.umask(0o077);
  t.teardown(async () => {
    process.umask(previousUmask);
    await chmod(join(packageRoot, "box-docs"), 0o755).catch(() => {});
    await rm(packageRoot, { recursive: true, force: true });
  });

  const first = await ensurePackageDocs({ packageRoot });
  const dir = join(packageRoot, "box-docs");
  const files = await readdir(dir);
  const modes = new Set<string>();
  for (const name of files) modes.add(((await stat(join(dir, name))).mode & 0o777).toString(8));
  t.check({
    first,
    dir: ((await stat(dir)).mode & 0o777).toString(8),
    fileModes: [...modes],
    hasFingerprint: files.includes(".hash"),
    second: await ensurePackageDocs({ packageRoot }),
  }, { first: { status: "written", dir }, dir: "755", fileModes: ["644"], hasFingerprint: true, second: { status: "current" } });

  // Another user's 0700 copy: the fingerprint cannot be read and the directory
  // cannot be replaced, so the result says so instead of throwing.
  await chmod(dir, 0o000);
  await chmod(packageRoot, 0o555);
  t.check(await ensurePackageDocs({ packageRoot }), { status: "unwritable", dir, reason: "EACCES writing " + dir });
  await chmod(packageRoot, 0o755);
});

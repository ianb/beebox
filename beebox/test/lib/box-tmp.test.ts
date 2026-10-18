// # Box-scoped temp dir: box-tmp
//
// `boxTmpDir(boxRoot)` returns the box's swept temp dir (`<boxRoot>/_tmp`) as a pure
// path — it touches no disk. `ensureBoxTmpDir(boxRoot)` creates that dir and
// returns its path. Box-request handlers use these instead of host `os.tmpdir()`
// so per-box scratch stays inside the box it belongs to (enforced for
// `src/webapp/routes|trpc` in `eslint.config.ts`).

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import { boxTmpDir, ensureBoxTmpDir } from "../../src/lib/box-tmp.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## ensureBoxTmpDir creates the dir and returns its path
void test("ensureBoxTmpDir creates the dir and returns its path", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L19
  const box = await makeTmpBox();
  const dir = await ensureBoxTmpDir(box.root);
  await t.checkText(dir === boxTmpDir(box.root), "true");

  // doctest:L26
  t.check(await fs.access(dir).then(() => "exists", () => "absent"), "exists");

  // doctest:L31
  // Idempotent — a second call on an existing dir is fine.
  const again = await ensureBoxTmpDir(box.root);
  await t.checkText(again === dir, "true");
});

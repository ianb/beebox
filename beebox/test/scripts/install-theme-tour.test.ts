// # Theme tour installer
//
// The persistent visual gallery is installed into an isolated box by copying only
// its owned `_content/theme-tour/` paths. Identical files are skipped and edited
// files are reported as conflicts, so refreshing the seed cannot erase a boxholder's
// work.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { installThemeTour } from "../../src/scripts/install-theme-tour.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## Installation is idempotent and preserves edits
void test("Installation is idempotent and preserves edits", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const source = `${box.root}/seed`;
  await box.write("seed/entry.card", "seed\n");
  const first = await installThemeTour(box.root, source);
  t.check(first, {
    copied: [
      "entry.card",
    ],
    skipped: [],
    conflicts: [],
  });

  const second = await installThemeTour(box.root, source);
  t.check(second, {
    copied: [],
    skipped: [
      "entry.card",
    ],
    conflicts: [],
  });

  await box.write("_content/theme-tour/entry.card", "human edit\n");
  const third = await installThemeTour(box.root, source);
  t.check(third, {
    copied: [],
    skipped: [],
    conflicts: [
      "entry.card",
    ],
  });
});

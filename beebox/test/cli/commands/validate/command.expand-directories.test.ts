// # `bbx validate <dir>`
//
// A directory argument expands to the cards and markdown files under it, using
// the whole-box walk and `_config/bbx-validate.ignore`.

import { join } from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { expandDirectories } from "../../../../src/cli/commands/validate/command.js";
import { loadValidationIgnore } from "../../../../src/core/validation-ignore.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

// A directory expands to its cards and markdown, minus ignored files and other
// directories; a file path passes through:
void test("A directory expands to its cards and markdown, minus ignored files", async (t) => {
  const box = await makeTmpBox();
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  await box.write("_content/projects/washer/a.doc.card", "---\ntitle: A\n---\n");
  await box.write("_content/projects/washer/notes.md", "# Notes\n");
  await box.write("_content/projects/washer/skip.doc.card", "---\ntitle: S\n---\n");
  await box.write("_content/projects/washer/data.json", "{}");
  await box.write("_content/projects/other/b.doc.card", "---\ntitle: B\n---\n");
  await box.write("_config/bbx-validate.ignore", "_content/projects/washer/skip.doc.card\n");
  const ignore = await loadValidationIgnore(box.root);
  const dir = join(box.root, "_content/projects/washer");
  const loose = join(box.root, "_content/projects/other/b.doc.card");

  const expanded = await expandDirectories([dir, loose], { boxRoot: box.root, ignore });
  t.check(
    expanded.map((p) => p.slice(box.root.length + 1)).toSorted(),
    ["_content/projects/other/b.doc.card", "_content/projects/washer/a.doc.card", "_content/projects/washer/notes.md"],
  );
});

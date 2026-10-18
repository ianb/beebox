// The cutover guard reads `git diff --cached --name-status -M`: only an
// added or copied .doctest.md is rejected; renames and edits pass.

import { test } from "tap";
import "agent-doctest/tap";
import { addedDoctests } from "../no-new-doctests.js";

void test("added and copied doctests are listed; edits, renames, and deletions are not", async (t) => {
  const nameStatus = [
    "A\tbeebox/test/new.doctest.md",
    "A\tbeebox/test/new.test.ts",
    "M\tbeebox/test/edited.doctest.md",
    "R100\tbeebox/test/old.doctest.md\tbeebox/test/moved/old.doctest.md",
    "C075\tbeebox/test/a.doctest.md\tbeebox/test/copy.doctest.md",
    "D\tbeebox/test/gone.doctest.md",
    "",
  ].join("\n");
  t.check(addedDoctests(nameStatus), ["beebox/test/new.doctest.md", "beebox/test/copy.doctest.md"]);
});

// A path's directory is everything before its last slash; a path at the box
// root has the empty directory.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parentDir } from "../../src/lib/parent-dir.js";

void test("cuts at the last slash", async (t) => {
  t.check(["a/b/c.card", "a/b", "root.card"].map(parentDir), ["a/b", "a", ""]);
});

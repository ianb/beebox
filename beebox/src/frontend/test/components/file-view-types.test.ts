// The frameless surface modes: an embed inside a card body and the
// conversation strip get no card frame; every other mode keeps its chrome.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isFrameless, type FileViewMode } from "../../src/components/file-view-types.js";

void test("embed and strip are frameless; chat and companion are not", async (t) => {
  const modes: FileViewMode[] = ["chat", "companion", "embed", "strip"];
  t.check(modes.map((mode) => [mode, isFrameless(mode)]), [
    ["chat", false],
    ["companion", false],
    ["embed", true],
    ["strip", true],
  ]);
});

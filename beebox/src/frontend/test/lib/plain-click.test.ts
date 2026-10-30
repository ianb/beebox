// # Plain left click
//
// Links that navigate in-app must leave modified clicks (new tab, new window,
// download) and non-primary buttons to the browser.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isPlainLeftClick } from "../../src/lib/plain-click.js";

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };

void test("only an unmodified primary-button click is plain", async (t) => {
  t.check(
    [
      plain,
      { ...plain, metaKey: true },
      { ...plain, ctrlKey: true },
      { ...plain, shiftKey: true },
      { ...plain, altKey: true },
      { ...plain, button: 1 },
      { ...plain, button: 2 },
    ].map(isPlainLeftClick),
    [true, false, false, false, false, false, false],
  );
});

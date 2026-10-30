// A keydown during an input method's composition is the IME's, not the page's:
// Enter that confirms composed text must not send a message. Safari marks the
// composition-ending Enter only with keyCode 229.
// First, and bare: the DOM KeyboardEvent comes from the happy-dom window.
import "../helpers/dom-harness.js";
import { test } from "tap";
import { isComposing } from "../../src/lib/ime.js";

void test("composition keydowns are recognized by either signal", async (t) => {
  const key = (init: KeyboardEventInit): boolean => isComposing(new KeyboardEvent("keydown", { key: "Enter", ...init }));
  t.check(
    { plain: key({}), composing: key({ isComposing: true }), safari: key({ keyCode: 229 }) },
    { plain: false, composing: true, safari: true },
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmTestedContent } from "./confirm-tested.js";

test("confirm clears manual-testing, records verification, and closes when no needs remain", () => {
  const result = confirmTestedContent(`---
title: Test me
workstream: seam
needs: [manual-testing]
---
## Manual testing

Try it.
`, "2026-08-09");
  assert.equal(result.close, true);
  assert.doesNotMatch(result.content, /needs:/);
  assert.match(result.content, /resolution: implemented/);
  assert.match(result.content, /> Verified by boxholder 2026-08-09/);
});

test("confirm preserves other needs and leaves the issue open", () => {
  const result = confirmTestedContent(`---
title: Test me
workstream: seam
needs: [decision, manual-testing]
---
## Manual testing
`, "2026-08-09");
  assert.equal(result.close, false);
  assert.match(result.content, /needs: \[decision\]/);
  assert.doesNotMatch(result.content, /resolution:/);
});

test("confirm refuses an issue without the flag", () => {
  assert.throws(() => confirmTestedContent(`---
title: Test me
workstream: seam
needs: [decision]
---
## Manual testing
`, "2026-08-09"), /does not need manual testing/);
});

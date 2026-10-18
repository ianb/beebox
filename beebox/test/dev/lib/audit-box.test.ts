// # Knowledge-audit box resolution
//
// `knowledge-audit run --box <path>` names a box's one root. `resolveAuditBox`
// resolves it and derives a stable ledger identity from the box root's
// basename.

import { test } from "tap";
import "agent-doctest/tap";
import * as path from "node:path";
import { resolveAuditBox } from "../../../src/dev/lib/audit-box.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("line 13", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L14
  const box = await makeTmpBox();
  const resolved = await resolveAuditBox(box.root);
  t.check(
    {
      operational: resolved.operationalRoot === box.root,
      boxName: resolved.boxName === path.basename(box.root),
    },
    {
    operational: true,
    boxName: true,
  },
  );
});

// A path that isn't a box passes through unchanged, named by its own basename:
void test("A path that isn't a box passes through unchanged, named by its own basename:", async (t) => {
  // doctest:L30
  const plain = path.resolve("test/dev/lib");
  const resolved = await resolveAuditBox(plain);
  t.check({ operational: resolved.operationalRoot === plain, boxName: resolved.boxName }, {
    operational: true,
    boxName: "lib",
  });
});

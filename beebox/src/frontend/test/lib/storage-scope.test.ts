// # Browser-storage scope
//
// Per-box browser state is keyed by box instance. In production the scope
// equals the box slug, so keys written before scoping stay readable; behind the
// dev router the scope (`main/test1`) tells two checkouts' `test1` apart.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { boxInstanceKey, storageScopeFor } from "../../src/lib/storage-scope.js";

void test("storageScopeFor is the box slug in production and names the checkout in dev", async (t) => {
  t.check([storageScopeFor("/test1/api"), storageScopeFor("/main/test1/api"), storageScopeFor("/worktree-foo/test1/api/")], ["test1", "main/test1", "worktree-foo/test1"]);
});

void test("boxInstanceKey is the slug with an empty scope, the scope otherwise", async (t) => {
  t.check(
    [
      boxInstanceKey({ boxSlug: "test1", scope: "" }),
      boxInstanceKey({ boxSlug: undefined, scope: "" }),
      boxInstanceKey({ boxSlug: "test1", scope: "main/test1" }),
      boxInstanceKey({ boxSlug: undefined, scope: "main/test1" }),
    ],
    ["test1", "default", "main/test1", "main/test1"],
  );
});

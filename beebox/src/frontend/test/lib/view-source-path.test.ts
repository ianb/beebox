// # Authored-view watcher paths
//
// `viewSlugFromSourcePath` recognizes both supported box layouts. This parser is
// shared by view-binding invalidation and active-module reload so package boxes
// cannot silently miss either half of live updating.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { viewSlugFromSourcePath } from "../../src/lib/view-source-path.js";

// Legacy and package-layout paths resolve to the same slug:
void test("Legacy and package-layout paths resolve to the same slug:", async (t) => {
  // doctest:L14
  t.check(viewSlugFromSourcePath("views/catalog.tsx"), "catalog");

  // doctest:L17
  t.check(viewSlugFromSourcePath("src/views/catalog.tsx"), "catalog");
});

// Files outside the direct authored-view directories are ignored:
void test("Files outside the direct authored-view directories are ignored:", async (t) => {
  // doctest:L24
  t.check(viewSlugFromSourcePath("src/views/helpers/catalog.tsx"), null);

  // doctest:L27
  t.check(viewSlugFromSourcePath("content/views/catalog.tsx"), null);

  // doctest:L30
  t.check(viewSlugFromSourcePath("src/views/catalog.ts"), null);
});

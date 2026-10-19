// # Box Path Normalization
//
// `boxRelativePath` converts the authoring/ref form of a box path (a leading slash
// means "box-root-absolute") into the canonical internal box-relative form (no
// leading slash) used by `ViewTarget.path`, `file-change` events, and the
// `/api/files` + `card.get` + `status.browse` boundaries. Emit boundaries call it
// to produce the canonical form; consume boundaries call it to tolerate either
// form before comparing or looking up.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { boxRelativePath } from "../../src/shared/box-path.js";

// A leading slash (the authoring/ref form) is stripped:
void test("A leading slash (the authoring/ref form) is stripped:", async (t) => {
  t.check(boxRelativePath("/_bookkeeping/archive/Foo.doc.card"), "_bookkeeping/archive/Foo.doc.card");
});

// Redundant leading slashes collapse, and the empty string (the box root) is left
// alone:
void test("Redundant leading slashes collapse, and the empty string (the box root) is le...", async (t) => {
  t.check(
    boxRelativePath("///people/Priya.person.card")
    ,
    "people/Priya.person.card",
  );

  t.check(boxRelativePath(""), "");
});

// Only the leading slash is touched — interior and trailing slashes are left as-is
// (document-relative resolution is `resolveRelativePath`'s job, not this helper's):
void test("Only the leading slash is touched — interior and trailing slashes are left as...", async (t) => {
  t.check(
    boxRelativePath("/_content//a/b.card")
    ,
    "_content//a/b.card",
  );
});

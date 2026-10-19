// # View refs
//
// Card refs inside box-authored views (`views/*.tsx`). The card-aware widgets
// (`beebox/view-widgets`) point at cards with a `cardRef="…"` attribute
// (`ref` is React-reserved). `extractViewRefs` finds them, `lintViewRefs` flags
// broken ones (the `bbx validate` half), and `rewriteViewRefs` rewrites them when a
// target moves (the `bbx mv` half). This is the JSX-view analogue of the Markdoc
// body-ref machinery — a different surface, the same `{path, ref}` shape.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractViewRefs, lintViewRefs } from "../../../src/core/views/refs.js";
import { collectViewCanonicalWarnings } from "../../../src/core/canonical-refs.js";
import { canonicalizeBox } from "../../../src/core/canonicalize-refs.js";
import { rewriteViewRefs } from "../../../src/core/rewrite-card-refs/core.js";
import { listBoxViewFiles } from "../../../src/core/list-cards.js";
import { loadValidationIgnore } from "../../../src/core/validation-ignore.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ## extractViewRefs finds literal `cardRef` attributes
//
// The ref value and a `view:<line>:<index>` path are returned.
void test("The ref value and a view:<line>:<index> path are returned.", async (t) => {
  // doctest:L27
  t.check(extractViewRefs('<CardLink cardRef="/_content/Foo.doc.card">Foo</CardLink>'), [
    { path: "view:1:0", ref: "/_content/Foo.doc.card" },
  ]);
});

// Single quotes work too.
void test("Single quotes work too.", async (t) => {
  // doctest:L44
  t.check(extractViewRefs("<CardRef cardRef='/_content/Bar.card' />"), [{ path: "view:1:0", ref: "/_content/Bar.card" }]);
});

// ## Line and index across multiple refs
//
// Lines are 1-indexed; the index increments per match.
void test("Lines are 1-indexed; the index increments per match.", async (t) => {
  // doctest:L53
  const src = [
    'import { CardLink, CardRef } from "beebox/view-widgets";',
    "",
    '<CardLink cardRef="/_content/a.doc.card" />',
    '<CardRef cardRef="/_content/b.record.card" />',
  ].join("\n");
  t.check(extractViewRefs(src), [
    {
      path: "view:3:0",
      ref: "/_content/a.doc.card",
    },
    {
      path: "view:4:1",
      ref: "/_content/b.record.card",
    },
  ]);
});

// ## Expression refs and DOM refs are not matched
//
// Only literal quoted `cardRef` attributes are tracked. An expression form
// (`cardRef={expr}`) is unresolvable statically, and a bare DOM `ref=` is not a
// card ref.
void test("Only literal quoted cardRef attributes are tracked.", async (t) => {
  // doctest:L80
  t.check(extractViewRefs("<CardLink cardRef={someVar} />"), []);

  // doctest:L83
  t.check(extractViewRefs('<input ref="x" />'), []);

  // doctest:L86
  t.check(extractViewRefs("plain source, no widgets"), []);
});

// ## lintViewRefs flags broken refs, passes existing ones
void test("lintViewRefs flags broken refs, passes existing ones", async (t) => {
  // doctest:L93
  const box = await makeTmpBox();
  await box.write("_content/Real.doc.card", "---\ntitle: Real\n---\nhi");
  await box.write(
    "views/v.tsx",
    '<CardLink cardRef="/_content/Real.doc.card" /><CardRef cardRef="/_content/Missing.doc.card" />',
  );
  const warnings = await lintViewRefs(`${box.root}/views/v.tsx`, box.root);
  t.check(warnings, ["Broken reference at view:1:1: /_content/Missing.doc.card does not exist"]);
});

// ## listBoxViewFiles resolves a box's views under `src/views/`
//
// shapeVersion 3 has one root — `boxCodePaths`' `viewsDir` is always
// `<boxRoot>/src/views/`, so `bbx validate`'s view-ref check and `bbx mv`'s
// ref-rewrite pass (both call `listBoxViewFiles`) find views there directly,
// with no package/content split to resolve:
void test("shapeVersion 3 has one root — boxCodePaths' viewsDir is always <boxRoot>/src/...", async (t) => {
  // doctest:L112
  const viewsBox = await makeTmpBox();
  await mkdir(join(viewsBox.root, "src/views"), { recursive: true });
  await writeFile(join(viewsBox.root, "src/views/dashboard.tsx"), "export default function Dashboard() { return null; }");
  const found = await listBoxViewFiles(viewsBox.root);
  t.check(found, [join(viewsBox.root, "src/views/dashboard.tsx")]);

  // doctest:L121
  await writeFile(join(viewsBox.root, "_content/people/alice.person.card"), "---\ntype: person\n---\nAlice\n");
  const view = join(viewsBox.root, "src/views/dashboard.tsx");
  await writeFile(view, '<CardLink cardRef="_content/people/alice.person.card" />');
  const canonicalWarnings = await collectViewCanonicalWarnings([view], viewsBox.root);
  t.check(canonicalWarnings, ["src/views/dashboard.tsx: Non-canonical ref at view:1:0: _content/people/alice.person.card → /_content/people/alice.person.card"]);

  // doctest:L128
  const fixed = await canonicalizeBox(viewsBox.root, {
    ignore: await loadValidationIgnore(viewsBox.root),
  });
  t.check({ refs: fixed.refsRewritten, files: fixed.filesChanged, view: await readFile(view, "utf-8") }, {
    refs: 1,
    files: 1,
    view: "<CardLink cardRef=\"/_content/people/alice.person.card\" />",
  });

  // doctest:L134
  const moved = rewriteViewRefs({
    boxRoot: viewsBox.root,
    viewAbsPath: view,
    text: '<CardLink cardRef="/_content/people/alice.person.card" /><CardRef cardRef="_content/people/alice.person.card" />',
    remap: (abs) =>
      abs === join(viewsBox.root, "_content/people/alice.person.card")
        ? join(viewsBox.root, "_content/people/alicia.person.card")
        : null,
  });
  t.check(moved, {
    text: "<CardLink cardRef=\"/_content/people/alicia.person.card\" /><CardRef cardRef=\"_content/people/alicia.person.card\" />",
    count: 2,
  });
});

// ## rewriteViewRefs rewrites a moved target, leaves others alone
//
// `remap` maps a resolved absolute path to its new home (or null). Only the
// `cardRef` whose target moved is rewritten; the count reflects real changes.
void test("remap maps a resolved absolute path to its new home (or null).", async (t) => {
  // doctest:L153
  const boxRoot = "/box";
  const text = '<CardLink cardRef="/_content/Foo.doc.card" /><CardRef cardRef="/_content/Stay.card" />';
  const remap = (abs: string) =>
    abs === "/box/_content/Foo.doc.card" ? "/box/_bookkeeping/archive/Foo.doc.card" : null;
  const result = rewriteViewRefs({ boxRoot, viewAbsPath: "/box/views/v.tsx", text, remap });
  t.check({ count: result.count, text: result.text }, {
    count: 1,
    text: "<CardLink cardRef=\"/_bookkeeping/archive/Foo.doc.card\" /><CardRef cardRef=\"/_content/Stay.card\" />",
  });
});

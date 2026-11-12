// # ui-check: frontend.md covers components/ui/
//
// `docCoverageProblems` compares the components and hooks exported from
// `components/ui/` with the names `frontend.md` gives them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { docCoverageProblems, primitivesSection } from "../../../src/dev/ui-check/doc-coverage.js";

const DOC = [
  "# Frontend",
  "",
  "## Frontend UI Primitives",
  "",
  "- `<Button>` — a button.",
  "- `useMaterial` — a hook.",
  "- `<Link>` — TanStack's.",
  "",
  "## Other",
  "",
  "`<Ghost>` is outside the section.",
].join("\n");

const EXPORTS = [
  { name: "Button", file: "Button.tsx" },
  { name: "useMaterial", file: "material.ts" },
];

// Exports that the doc names, and a `<Name>` of TanStack's `Link`, give no problem.
void test("a doc that names every export and only real components has no problems", async (t) => {
  t.check(docCoverageProblems({ exports: EXPORTS, doc: DOC, internals: [] }), []);
});

// An export absent from the doc is reported with its file; a name only in
// prose, without backticks or `<`, does not count as named.
void test("an export the doc does not name is reported", async (t) => {
  t.check(
    docCoverageProblems({
      exports: [...EXPORTS, { name: "Notice", file: "Notice.tsx" }],
      doc: `${DOC}\nNotice is mentioned in prose only.`,
      internals: [],
    }),
    ["frontend.md does not name Notice (components/ui/Notice.tsx); name it in backticks (`<Notice>` for a component)"],
  );
});

// A `<Name>` in the primitives section must be an export; one in another
// section is ignored.
void test("a primitives entry with no export is reported, and other sections are ignored", async (t) => {
  t.check(
    docCoverageProblems({ exports: EXPORTS, doc: DOC.replace("- `<Link>`", "- `<Phantom>` — gone.\n- `<Link>`"), internals: [] }),
    ["frontend.md names <Phantom> in its primitives section, but components/ui/ exports no Phantom"],
  );
});

// An allow-listed name needs no doc entry, but only the listed ui file may
// import it: an importer outside `ui/` or a wrong reason is reported.
void test("an allow-listed name is exempt from the doc and checked against its importers", async (t) => {
  const internals = [{ name: "FieldShell", reason: "fields/field.tsx" }];
  const exports = [...EXPORTS, { name: "FieldShell", file: "fields/shell.tsx" }];
  t.check(
    docCoverageProblems({ exports, doc: DOC, internals, internalImports: [{ name: "FieldShell", file: "ui/fields/field.tsx" }] }),
    [],
  );
  t.check(
    docCoverageProblems({
      exports,
      doc: DOC,
      internals,
      internalImports: [
        { name: "FieldShell", file: "ui/fields/field.tsx" },
        { name: "FieldShell", file: "admin/Form.tsx" },
      ],
    }),
    [
      "FieldShell is ui-internal but components/admin/Form.tsx imports it; document it in frontend.md and drop it from the allow-list, or stop importing it",
    ],
  );
  t.check(
    docCoverageProblems({ exports, doc: DOC, internals, internalImports: [{ name: "FieldShell", file: "ui/other.tsx" }] }),
    ["ui-check allow-list: components/ui/fields/field.tsx does not import FieldShell"],
  );
  t.check(docCoverageProblems({ exports: EXPORTS, doc: DOC, internals }), [
    "ui-check allow-list: FieldShell is not an export of components/ui/",
    "ui-check allow-list: components/ui/fields/field.tsx does not import FieldShell",
  ]);
});

// The section runs from its `##` heading to the next `##`.
void test("primitivesSection returns the section body or null", async (t) => {
  t.check(
    primitivesSection(DOC),
    "\n\n- `<Button>` — a button.\n- `useMaterial` — a hook.\n- `<Link>` — TanStack's.\n",
  );
  t.check(primitivesSection("# Nothing\n"), null);
});

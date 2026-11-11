// # ui-check: reading exports and imports
//
// `exportedValueNames` lists value exports; `isDocumentedKind` keeps
// components and hooks; `importedNames` lists named imports.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseSourceFile } from "../../../src/dev/layout/scan/imports.js";
import { exportedValueNames, importedNames, isDocumentedKind } from "../../../src/dev/ui-check/exports.js";

function parse(sourceText: string) {
  return parseSourceFile({ fileName: "pkg/ui/mod.tsx", sourceText });
}

// Functions, consts and classes count, as do `export { }` names and
// `export { } from` re-exports (by the exported name); types and interfaces do not.
void test("exportedValueNames lists value exports, including re-exports, and skips types", async (t) => {
  const source = [
    "export function Button() { return null; }",
    "export const NOTICE_CLASSES = {};",
    "export const useThing = () => 1;",
    "export class Widget {}",
    "export type Props = {};",
    "export interface More {}",
    "export { Radio } from \"./radio\";",
    "const Local = 1;",
    "export { Local };",
    "function hidden() {}",
  ].join("\n");
  t.check(exportedValueNames(parse(source)), ["Button", "NOTICE_CLASSES", "useThing", "Widget", "Radio", "Local"]);
});

void test("exportedValueNames lists renamed re-exports by exported name and skips type re-exports", async (t) => {
  const source = [
    "export { Button as FreshWidget } from \"./Button\";",
    "export { type Props, Other } from \"./other\";",
    "export type { Gone } from \"./gone\";",
    "const Inner = 1;",
    "export { Inner as Outer };",
  ].join("\n");
  t.check(exportedValueNames(parse(source)), ["FreshWidget", "Other", "Outer"]);
});

void test("exportedValueNames resolves a default export of a local", async (t) => {
  t.check(exportedValueNames(parse("const FreshWidget = () => null;\nexport default FreshWidget;")), ["FreshWidget"]);
  t.check(exportedValueNames(parse("export default function Named() { return null; }")), ["Named"]);
});

void test("exportedValueNames rejects an anonymous default export", async (t) => {
  for (const source of ["export default function () { return null; }", "export default () => null;", "export default memo(Thing);"]) {
    await t.checkThrows(
      () => exportedValueNames(parse(source)),
      "AnonymousDefaultExportError: anonymous default export; name it (const X = ...; export default X) so ui-check can read it",
    );
  }
});

// PascalCase and `use*` count; `ALL_CAPS` and camelCase helpers do not.
void test("isDocumentedKind keeps components and hooks", async (t) => {
  t.check(["Button", "ModalDialog", "useMenuClose", "NOTICE_CLASSES", "toastError", "Image"].map(isDocumentedKind), [
    true,
    true,
    true,
    false,
    false,
    true,
  ]);
});

// Each named import appears with the name the exporter declares.
void test("importedNames lists named value imports by their exported name", async (t) => {
  const source = ["import { A, B as C } from \"./x\";", "import D from \"./d\";"].join("\n");
  t.check(importedNames(parse(source)), [
    { specifier: "./x", name: "A" },
    { specifier: "./x", name: "B" },
  ]);
});

// A namespace import yields one record per static member access; any other use
// of the namespace yields `*`, which stands for every export.
void test("importedNames reads namespace imports and their static member accesses", async (t) => {
  const source = [
    "import * as fields from \"../ui/fields/shell\";",
    "const a = fields.FieldShell;",
    "const b = fields[\"FieldMessage\"];",
    "const c = <fields.RevealButton />;",
  ].join("\n");
  t.check(importedNames(parse(source)), [
    { specifier: "../ui/fields/shell", name: "FieldShell" },
    { specifier: "../ui/fields/shell", name: "FieldMessage" },
    { specifier: "../ui/fields/shell", name: "RevealButton" },
  ]);
  t.check(importedNames(parse("import * as ns from \"./x\";\nuse(ns);")), [{ specifier: "./x", name: "*" }]);
});

void test("importedNames skips type-only imports", async (t) => {
  t.check(importedNames(parse("import type { A } from \"./x\";\nimport type * as ns from \"./y\";\nns;")), []);
});

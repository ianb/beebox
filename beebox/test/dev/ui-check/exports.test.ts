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

// Functions, consts and classes count, as do local `export { }` names; types,
// interfaces and `export ... from` re-exports do not.
void test("exportedValueNames lists value exports and skips types and re-exports", async (t) => {
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
  t.check(exportedValueNames(parse(source)), ["Button", "NOTICE_CLASSES", "useThing", "Widget", "Local"]);
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
  const source = ["import { A, B as C } from \"./x\";", "import D from \"./d\";", "import * as E from \"./e\";"].join("\n");
  t.check(importedNames(parse(source)), [
    { specifier: "./x", name: "A" },
    { specifier: "./x", name: "B" },
  ]);
});

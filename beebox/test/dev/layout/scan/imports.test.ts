// # Scanner: AST import extraction
//
// `extractModuleFacts` reads a parsed source file's import edges (before
// resolution) and the other per-module facts: `reexportOnly`, `topLevelCalls`,
// `relativePathLiterals`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractModuleFacts, parseSourceFile } from "../../../../src/dev/layout/scan/imports.js";

function facts(source: string) {
  const sourceFile = parseSourceFile({ fileName: "pkg/src/mod.ts", sourceText: source });
  return extractModuleFacts(sourceFile);
}

// ## The four import forms
//
// A default/named import is a value import; `import type` and an all-type
// named-import list are type-only; a side-effect import binds no names and is
// a value import.
void test("A default/named import is a value import; import type and an all-type named-i...", async (t) => {
  // doctest:L23
  t.check(facts("import A from \"./a.js\";").imports, [
    {
      specifier: "./a.js",
      typeOnly: false,
      names: [
        "A",
      ],
      dynamic: false,
    },
  ]);

  // doctest:L26
  t.check(facts("import type { A } from \"./b.js\";").imports, [
    {
      specifier: "./b.js",
      typeOnly: true,
      names: [
        "A",
      ],
      dynamic: false,
    },
  ]);

  // doctest:L29
  t.check(facts("import { type A, type B } from \"./c.js\";").imports, [
    {
      specifier: "./c.js",
      typeOnly: true,
      names: [
        "A",
        "B",
      ],
      dynamic: false,
    },
  ]);

  // doctest:L32
  t.check(facts("import \"./d.js\";").imports, [
    {
      specifier: "./d.js",
      typeOnly: false,
      names: [],
      dynamic: false,
    },
  ]);
});

// A named import mixing a type and a value binding is a value import as a
// whole (not every element is type-only).
void test("A named import mixing a type and a value binding is a value import as a whole...", async (t) => {
  // doctest:L40
  t.check(facts("import { type A, B } from \"./e.js\";").imports, [
    {
      specifier: "./e.js",
      typeOnly: false,
      names: [
        "A",
        "B",
      ],
      dynamic: false,
    },
  ]);
});

// ## Dynamic import and require, anywhere
void test("Dynamic import and require, anywhere", async (t) => {
  // doctest:L47
  t.check(facts("async function f() { await import(\"./f.js\"); }").imports, [
    {
      specifier: "./f.js",
      typeOnly: false,
      names: [],
      dynamic: true,
    },
  ]);

  // doctest:L50
  t.check(facts("const x = require(\"./g.js\");").imports, [
    {
      specifier: "./g.js",
      typeOnly: false,
      names: [],
      dynamic: false,
    },
  ]);
});

// ## Export declarations with a module specifier
void test("Export declarations with a module specifier", async (t) => {
  // doctest:L57
  t.check(facts("export { x } from \"./h.js\";").imports, [
    {
      specifier: "./h.js",
      typeOnly: false,
      names: [],
      dynamic: false,
    },
  ]);

  // doctest:L60
  t.check(facts("export type { Y } from \"./i.js\";").imports, [
    {
      specifier: "./i.js",
      typeOnly: true,
      names: [],
      dynamic: false,
    },
  ]);
});

// ## `reexportOnly`
//
// True only when every top-level statement is an import or an export, and at
// least one is an export.
void test("True only when every top-level statement is an import or an export, and at le...", async (t) => {
  // doctest:L70
  t.check(facts("import { a } from \"./a.js\";\nexport { a };").reexportOnly, true);

  // doctest:L73
  t.check(facts("export function f() {}").reexportOnly, false);

  // doctest:L76
  t.check(facts("import { a } from \"./a.js\";").reexportOnly, false);
});

// ## `topLevelCalls`
//
// Callee text of top-level expression-statement calls, `await` unwrapped.
void test("Callee text of top-level expression-statement calls, await unwrapped.", async (t) => {
  // doctest:L85
  t.check(facts("registerConnector(x);\nawait init();").topLevelCalls, [
    "registerConnector",
    "init",
  ]);
});

// ## `relativePathLiterals`
//
// A relative string or no-substitution template literal that is not an
// import/export/dynamic-import/require specifier.
void test("A relative string or no-substitution template literal that is not an import/e...", async (t) => {
  // doctest:L95
  t.check(facts("import { a } from \"./a.js\";\nconst p = \"./data/foo.json\";\nconst q = `../other`;").relativePathLiterals, [
    "./data/foo.json",
    "../other",
  ]);
});

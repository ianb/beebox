// # Scanner: `defineRegistry` extraction
//
// `extractRegistries` reads every `defineRegistry` call out of a parsed source
// file. Member sources come from the caller's already-resolved import edges.
// A call is only recognized when its callee resolves through an import of the
// package's `src/shared/registry.ts`: a local (possibly renamed) binding of
// `defineRegistry`, or `<namespace>.defineRegistry(...)`. A same-named
// identifier bound to any other module is not a registry call.

import { test } from "tap";
import "agent-doctest/tap";
import { extractRegistries } from "../../../../../src/dev/layout/scan/package/registries.js";
import { parseSourceFile } from "../../../../../src/dev/layout/scan/imports.js";
import type { ImportEdge } from "../../../../../src/dev/layout/model.js";

function edge(params: { specifier: string; names: string[]; target: string | null }): ImportEdge {
  return { specifier: params.specifier, target: params.target, external: false, typeOnly: false, names: params.names, dynamic: false };
}

function registriesOf(source: string, imports?: ImportEdge[]) {
  const sourceFile = parseSourceFile({ fileName: "pkg/src/mod.ts", sourceText: source });
  return extractRegistries({ sourceFile, filePath: "pkg/src/mod.ts", imports: imports ?? [] });
}

const registryImportLine = "import { defineRegistry } from \"../shared/registry.js\";\n";
const registryEdge = edge({ specifier: "../shared/registry.js", names: ["defineRegistry"], target: "pkg/src/shared/registry.ts" });

// ## A list form, an identifier member resolved to its import, ordered true
void test("A list form, an identifier member resolved to its import, ordered true", async (t) => {
  // doctest:L31
  const source = `${registryImportLine}import { Verb } from "./verb.js";\nexport const commands = defineRegistry<Verb>({\n  directory: "./commands",\n  entry: "command",\n  ordered: true,\n  members: [Verb, other("x")],\n});\n`;
  const result = registriesOf(source, [
    registryEdge,
    edge({ specifier: "./verb.js", names: ["Verb"], target: "pkg/src/verb.ts" }),
  ]);
  t.check(result.registries, [
    {
      directory: "pkg/src/commands",
      entry: "command",
      ordered: true,
      form: "list",
      members: [
        {
          expression: "Verb",
          source: "pkg/src/verb.ts",
          key: null,
        },
        {
          expression: "other(\"x\")",
          source: null,
          key: null,
        },
      ],
      line: 3,
    },
  ]);

  // doctest:L39
  await t.checkText(result.findings.length, "0");
});

// ## A record form, `entry` absent defaults to null, `ordered` absent defaults to false
void test("A record form, `entry` absent defaults to null, `ordered` absent defaults to false", async (t) => {
  // doctest:L46
  const source2 = `${registryImportLine}export const surfaces = defineRegistry({\n  directory: "./exports",\n  members: { schema: SchemaMod, cards: "cards.ts" },\n});\n`;
  const result2 = registriesOf(source2, [
    registryEdge,
    edge({ specifier: "./schema.js", names: ["SchemaMod"], target: "pkg/src/exports/schema.ts" }),
  ]);
  t.check(result2.registries, [
    {
      directory: "pkg/src/exports",
      entry: null,
      ordered: false,
      form: "record",
      members: [
        {
          expression: "SchemaMod",
          source: "pkg/src/exports/schema.ts",
          key: "schema",
        },
        {
          expression: "\"cards.ts\"",
          source: null,
          key: "cards",
        },
      ],
      line: 2,
    },
  ]);
});

// ## A non-literal `directory` is a scan finding, not a registry
void test("A non-literal `directory` is a scan finding, not a registry", async (t) => {
  // doctest:L58
  const source3 = `${registryImportLine}defineRegistry({\n  directory: computeDir(),\n  ordered: false,\n  members: [],\n});\n`;
  const result3 = registriesOf(source3, [registryEdge]);
  await t.checkText(result3.registries.length, "0");

  // doctest:L63
  t.check(result3.findings, [
    {
      rule: "scan",
      path: "pkg/src/mod.ts",
      message: "defineRegistry directory is not a string literal",
    },
  ]);
});

// ## A first argument that is not an object literal is a scan finding
void test("A first argument that is not an object literal is a scan finding", async (t) => {
  // doctest:L70
  t.check(registriesOf(`${registryImportLine}defineRegistry(members);\n`, [registryEdge]).findings[0]?.message, "defineRegistry argument is not an object literal");
});

// ## `members` that is neither an array nor an object literal is a scan finding
void test("`members` that is neither an array nor an object literal is a scan finding", async (t) => {
  // doctest:L77
  const source4 = `${registryImportLine}defineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: someCall(),\n});\n`;
  t.check(registriesOf(source4, [registryEdge]).findings[0]?.message, "defineRegistry members is not an array or object literal");
});

// ## Parens, `satisfies`, and `as` around the first argument are unwrapped
void test("Parens, `satisfies`, and `as` around the first argument are unwrapped", async (t) => {
  // doctest:L85
  const source5 = `${registryImportLine}defineRegistry(({\n  directory: "./z",\n  ordered: false,\n  members: [],\n} as SomeType));\n`;
  t.check(registriesOf(source5, [registryEdge]).registries[0]?.directory, "pkg/src/z");

  // doctest:L89
  const source6 = `${registryImportLine}defineRegistry({\n  directory: "./w",\n  ordered: false,\n  members: [],\n} satisfies unknown);\n`;
  t.check(registriesOf(source6, [registryEdge]).registries[0]?.directory, "pkg/src/w");
});

// ## A renamed import is recognized by its imported name, not its local text
void test("A renamed import is recognized by its imported name, not its local text", async (t) => {
  // doctest:L97
  const source7 = "import { defineRegistry as reg } from \"../shared/registry.js\";\nreg({\n  directory: \"./renamed\",\n  ordered: false,\n  members: [],\n});\n";
  t.check(registriesOf(source7, [edge({ specifier: "../shared/registry.js", names: ["reg"], target: "pkg/src/shared/registry.ts" })]).registries[0]?.directory, "pkg/src/renamed");
});

// ## A namespace import is recognized via `<namespace>.defineRegistry(...)`
void test("A namespace import is recognized via `<namespace>.defineRegistry(...)`", async (t) => {
  // doctest:L105
  const source8 = "import * as r from \"../shared/registry.js\";\nr.defineRegistry({\n  directory: \"./ns\",\n  ordered: false,\n  members: [],\n});\n";
  t.check(registriesOf(source8, [edge({ specifier: "../shared/registry.js", names: ["r"], target: "pkg/src/shared/registry.ts" })]).registries[0]?.directory, "pkg/src/ns");
});

// ## `members` bound by a same-file `const` to a literal is read as if inline
void test("`members` bound by a same-file `const` to a literal is read as if inline", async (t) => {
  // doctest:L113
  const source10 = `${registryImportLine}import { Verb } from "./verb.js";\nconst commandList = [Verb];\nexport const commands = defineRegistry<Verb>({\n  directory: "./commands",\n  ordered: false,\n  members: commandList,\n});\n`;
  const result10 = registriesOf(source10, [
    registryEdge,
    edge({ specifier: "./verb.js", names: ["Verb"], target: "pkg/src/verb.ts" }),
  ]);
  t.check(result10.registries, [
    {
      directory: "pkg/src/commands",
      entry: null,
      ordered: false,
      form: "list",
      members: [
        {
          expression: "Verb",
          source: "pkg/src/verb.ts",
          key: null,
        },
      ],
      line: 4,
    },
  ]);

  // doctest:L121
  await t.checkText(result10.findings.length, "0");
});

// A record-form `const` wrapped in `satisfies` resolves the same way.
void test("A record-form const wrapped in satisfies resolves the same way.", async (t) => {
  // doctest:L128
  const source11 = `${registryImportLine}import { SchemaMod } from "./schema.js";\nconst surfaceMap = {\n  schema: SchemaMod,\n} satisfies Record<string, unknown>;\ndefineRegistry({\n  directory: "./exports",\n  ordered: false,\n  members: surfaceMap,\n});\n`;
  const result11 = registriesOf(source11, [
    registryEdge,
    edge({ specifier: "./schema.js", names: ["SchemaMod"], target: "pkg/src/exports/schema.ts" }),
  ]);
  t.check(result11.registries[0]?.members, [
    {
      expression: "SchemaMod",
      source: "pkg/src/exports/schema.ts",
      key: "schema",
    },
  ]);
});

// ## `members` bound to a non-`const`, or to a non-literal, stays a scan finding
void test("`members` bound to a non-`const`, or to a non-literal, stays a scan finding", async (t) => {
  // doctest:L140
  const source13 = `${registryImportLine}let commandList = [];\ndefineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: commandList,\n});\n`;
  t.check(registriesOf(source13, [registryEdge]).findings[0]?.message, "defineRegistry members is not an array or object literal");

  // doctest:L144
  const source14 = `${registryImportLine}const commandList = computeList();\ndefineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: commandList,\n});\n`;
  t.check(registriesOf(source14, [registryEdge]).findings[0]?.message, "defineRegistry members is not an array or object literal");
});

// ## A same-named function imported from elsewhere is not recognized
void test("A same-named function imported from elsewhere is not recognized", async (t) => {
  // doctest:L152
  const source9 = "import { defineRegistry } from \"./other.js\";\ndefineRegistry({\n  directory: \"./ignored\",\n  ordered: false,\n  members: [],\n});\n";
  const result9 = registriesOf(source9, [edge({ specifier: "./other.js", names: ["defineRegistry"], target: "pkg/src/other.ts" })]);
  await t.checkText(result9.registries.length, "0");

  // doctest:L157
  await t.checkText(result9.findings.length, "0");
});

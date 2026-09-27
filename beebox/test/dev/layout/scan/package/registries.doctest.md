# Scanner: `defineRegistry` extraction

`extractRegistries` reads every `defineRegistry` call out of a parsed source
file. Member sources come from the caller's already-resolved import edges.
A call is only recognized when its callee resolves through an import of the
package's `src/shared/registry.ts`: a local (possibly renamed) binding of
`defineRegistry`, or `<namespace>.defineRegistry(...)`. A same-named
identifier bound to any other module is not a registry call.

```ts setup
import { extractRegistries } from "../../../../../src/dev/layout/scan/package/registries.js";
import { parseSourceFile } from "../../../../../src/dev/layout/scan/imports.js";
import type { ImportEdge } from "../../../../../src/dev/layout/model.js";

function edge(params: { specifier: string; names: string[]; target: string | null }): ImportEdge {
  return { specifier: params.specifier, target: params.target, external: false, typeOnly: false, names: params.names, dynamic: false };
}

function registriesOf(source: string, imports: ImportEdge[] = []) {
  const sourceFile = parseSourceFile({ fileName: "pkg/src/mod.ts", sourceText: source });
  return extractRegistries({ sourceFile, filePath: "pkg/src/mod.ts", imports });
}

const registryImportLine = `import { defineRegistry } from "../shared/registry.js";\n`;
const registryEdge = edge({ specifier: "../shared/registry.js", names: ["defineRegistry"], target: "pkg/src/shared/registry.ts" });
```

## A list form, an identifier member resolved to its import, ordered true

```ts
const source = `${registryImportLine}import { Verb } from "./verb.js";\nexport const commands = defineRegistry<Verb>({\n  directory: "./commands",\n  entry: "command",\n  ordered: true,\n  members: [Verb, other("x")],\n});\n`;
const result = registriesOf(source, [
  registryEdge,
  edge({ specifier: "./verb.js", names: ["Verb"], target: "pkg/src/verb.ts" }),
]);
JSON.stringify(result.registries)
=> [{"directory":"pkg/src/commands","entry":"command","ordered":true,"form":"list","members":[{"expression":"Verb","source":"pkg/src/verb.ts","key":null},{"expression":"other(\"x\")","source":null,"key":null}],"line":3}]

result.findings.length
=> 0
```

## A record form, `entry` absent defaults to null, `ordered` absent defaults to false

```ts
const source2 = `${registryImportLine}export const surfaces = defineRegistry({\n  directory: "./exports",\n  members: { schema: SchemaMod, cards: "cards.ts" },\n});\n`;
const result2 = registriesOf(source2, [
  registryEdge,
  edge({ specifier: "./schema.js", names: ["SchemaMod"], target: "pkg/src/exports/schema.ts" }),
]);
JSON.stringify(result2.registries)
=> [{"directory":"pkg/src/exports","entry":null,"ordered":false,"form":"record","members":[{"expression":"SchemaMod","source":"pkg/src/exports/schema.ts","key":"schema"},{"expression":"\"cards.ts\"","source":null,"key":"cards"}],"line":2}]
```

## A non-literal `directory` is a scan finding, not a registry

```ts
const source3 = `${registryImportLine}defineRegistry({\n  directory: computeDir(),\n  ordered: false,\n  members: [],\n});\n`;
const result3 = registriesOf(source3, [registryEdge]);
result3.registries.length
=> 0

JSON.stringify(result3.findings)
=> [{"rule":"scan","path":"pkg/src/mod.ts","message":"defineRegistry directory is not a string literal"}]
```

## A first argument that is not an object literal is a scan finding

```ts
registriesOf(`${registryImportLine}defineRegistry(members);\n`, [registryEdge]).findings[0]?.message
=> defineRegistry argument is not an object literal
```

## `members` that is neither an array nor an object literal is a scan finding

```ts
const source4 = `${registryImportLine}defineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: someCall(),\n});\n`;
registriesOf(source4, [registryEdge]).findings[0]?.message
=> defineRegistry members is not an array or object literal
```

## Parens, `satisfies`, and `as` around the first argument are unwrapped

```ts
const source5 = `${registryImportLine}defineRegistry(({\n  directory: "./z",\n  ordered: false,\n  members: [],\n} as SomeType));\n`;
registriesOf(source5, [registryEdge]).registries[0]?.directory
=> pkg/src/z

const source6 = `${registryImportLine}defineRegistry({\n  directory: "./w",\n  ordered: false,\n  members: [],\n} satisfies unknown);\n`;
registriesOf(source6, [registryEdge]).registries[0]?.directory
=> pkg/src/w
```

## A renamed import is recognized by its imported name, not its local text

```ts
const source7 = `import { defineRegistry as reg } from "../shared/registry.js";\nreg({\n  directory: "./renamed",\n  ordered: false,\n  members: [],\n});\n`;
registriesOf(source7, [edge({ specifier: "../shared/registry.js", names: ["reg"], target: "pkg/src/shared/registry.ts" })]).registries[0]?.directory
=> pkg/src/renamed
```

## A namespace import is recognized via `<namespace>.defineRegistry(...)`

```ts
const source8 = `import * as r from "../shared/registry.js";\nr.defineRegistry({\n  directory: "./ns",\n  ordered: false,\n  members: [],\n});\n`;
registriesOf(source8, [edge({ specifier: "../shared/registry.js", names: ["r"], target: "pkg/src/shared/registry.ts" })]).registries[0]?.directory
=> pkg/src/ns
```

## `members` bound by a same-file `const` to a literal is read as if inline

```ts
const source10 = `${registryImportLine}import { Verb } from "./verb.js";\nconst commandList = [Verb];\nexport const commands = defineRegistry<Verb>({\n  directory: "./commands",\n  ordered: false,\n  members: commandList,\n});\n`;
const result10 = registriesOf(source10, [
  registryEdge,
  edge({ specifier: "./verb.js", names: ["Verb"], target: "pkg/src/verb.ts" }),
]);
JSON.stringify(result10.registries)
=> [{"directory":"pkg/src/commands","entry":null,"ordered":false,"form":"list","members":[{"expression":"Verb","source":"pkg/src/verb.ts","key":null}],"line":4}]

result10.findings.length
=> 0
```

A record-form `const`, and one wrapped in `satisfies`/`as const`, resolve the
same way.

```ts
const source11 = `${registryImportLine}import { SchemaMod } from "./schema.js";\nconst surfaceMap = {\n  schema: SchemaMod,\n} satisfies Record<string, unknown>;\ndefineRegistry({\n  directory: "./exports",\n  ordered: false,\n  members: surfaceMap,\n});\n`;
const result11 = registriesOf(source11, [
  registryEdge,
  edge({ specifier: "./schema.js", names: ["SchemaMod"], target: "pkg/src/exports/schema.ts" }),
]);
JSON.stringify(result11.registries[0]?.members)
=> [{"expression":"SchemaMod","source":"pkg/src/exports/schema.ts","key":"schema"}]

const source12 = `${registryImportLine}import { Verb } from "./verb.js";\nconst commandList = [Verb] as const;\ndefineRegistry<Verb>({\n  directory: "./commands",\n  ordered: false,\n  members: commandList,\n});\n`;
registriesOf(source12, [
  registryEdge,
  edge({ specifier: "./verb.js", names: ["Verb"], target: "pkg/src/verb.ts" }),
]).registries[0]?.members[0]?.expression
=> Verb
```

## `members` bound to a non-`const`, or to a non-literal, stays a scan finding

```ts
const source13 = `${registryImportLine}let commandList = [];\ndefineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: commandList,\n});\n`;
registriesOf(source13, [registryEdge]).findings[0]?.message
=> defineRegistry members is not an array or object literal

const source14 = `${registryImportLine}const commandList = computeList();\ndefineRegistry({\n  directory: "./x",\n  ordered: false,\n  members: commandList,\n});\n`;
registriesOf(source14, [registryEdge]).findings[0]?.message
=> defineRegistry members is not an array or object literal
```

## A same-named function imported from elsewhere is not recognized

```ts
const source9 = `import { defineRegistry } from "./other.js";\ndefineRegistry({\n  directory: "./ignored",\n  ordered: false,\n  members: [],\n});\n`;
const result9 = registriesOf(source9, [edge({ specifier: "./other.js", names: ["defineRegistry"], target: "pkg/src/other.ts" })]);
result9.registries.length
=> 0

result9.findings.length
=> 0
```

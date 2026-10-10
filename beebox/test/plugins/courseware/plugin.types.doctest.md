# Courseware plugin: a box stub is typed against the published bases

`beebox/plugins/courseware` resolves to `dist/plugins/courseware/plugin.d.ts`
(the `types` target of the `./plugins/*` export). `definePlugin` infers the
schemas map, so that declaration carries each base's precise
`CardSchemaConfig<string, { ...fields }>` rather than an erased field map, and
`extendSchema` in a box stub keeps the base's fields typed and rejects a
redeclared one under `tsc`, before the runtime `RedeclaredFieldError`.

The setup emits the declarations into `dist/` the way `pnpm build:cli` does
(`tsc -p tsconfig.declarations.json`), then typechecks a stub written into a
temp box whose `node_modules/beebox` points at this package, with the box's own
scaffolded `tsconfig.json` (`extends: "beebox/tsconfig.base.json"`). The box
resolves `beebox/*` through the package `exports` map, as an installed box does.

```ts setup
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const exec = promisify(execFile);
await exec(process.execPath, [fileURLToPath(import.meta.resolve("typescript/lib/tsc.js")), "-p", "tsconfig.declarations.json"], {
  cwd: PACKAGE_ROOT,
});

const STUB = "src/schemas/progress.ts";
const STUB_HEAD = `
import { cardSchema, extendSchema, type InferCardFields } from "beebox/cards";
import { z } from "beebox/schema";
import courseware from "beebox/plugins/courseware";
`;

/**
 * Diagnostics for a box holding `source` as its progress stub, each as the
 * offending line's text and the message. A diagnostic outside the stub (a
 * declaration that failed to resolve) is reported by file name, so a silent
 * `any` from an unresolved import cannot pass the stub.
 */
async function typecheckStub(source: string): Promise<string[]> {
  const box = await makeTmpBox({ deps: true });
  await box.write(STUB, `${STUB_HEAD}${source}`);
  const configPath = box.path("tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, box.root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const stubPath = box.path(STUB);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file === undefined) return message;
    if (d.file.fileName !== stubPath) return `${d.file.fileName.slice(PACKAGE_ROOT.length)}: ${message}`;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    const text = d.file.text.split("\n")[line]?.trim() ?? "";
    return `${text}\n  ${message}`;
  });
}
```

## The README's stub and the documented extension compile

The plain completion (`src/plugins/courseware/README.md`, Setup) and the
extension `docs/plugins.md` shows (adding `mood`) both typecheck; the delta's
`summarize` sees the base's `entries` with its element type and the added
`mood`.

```ts timeout=120s
await typecheckStub(`
export const Plain = cardSchema("progress", courseware.schemas.progress);
export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({
    ...base,
    detail: \`\${card.entries?.filter((e) => e.level === "solid").length ?? 0} solid, mood \${card.mood ?? "unset"}\`,
  }),
}));
`)
=> []
```

## The base's field types reach the stub

A field neither side declares, a wrong value for a base enum, and a wrong type
for a base field are each compile errors; `InferCardFields` on the completed
schema carries the base fields with their types and the added one.

```ts timeout=120s
await typecheckStub(`
const Progress = cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({ ...base, detail: \`\${card.nope} \${card.entries?.[0]?.level === "fluent"}\` }),
}));
type Fields = InferCardFields<typeof Progress>;
const typed: Fields = { type: "progress", learner: "the-learner", body: "", mood: "bright", entries: [] };
const wrongLearner: Fields = { type: "progress", learner: 5, body: "" };
void typed;
void wrongLearner;
`)
=>
[
  "summarize: (card, base) => ({ ...base, detail: `${card.nope} ${card.entries?.[0]?.level === \"fluent\"}` }),\n  Property 'nope' does not exist on type 'CardFieldsOf<string, { course: «*»",
  "summarize: (card, base) => ({ ...base, detail: `${card.nope} ${card.entries?.[0]?.level === \"fluent\"}` }),\n  This comparison appears to be unintentional because the types '\"unfamiliar\" | \"partial\" | \"working\" | \"solid\" | undefined' and '\"fluent\"' have no overlap.",
  "const wrongLearner: Fields = { type: \"progress\", learner: 5, body: \"\" };\n  Type 'number' is not assignable to type 'string'.",
]
```

## Redeclaring a base field fails under `tsc`

The runtime `RedeclaredFieldError` (`test/cards/extend-schema.doctest.md`) is
the fallback for a box running under type stripping; a typechecked box is
told at compile time.

```ts timeout=120s
await typecheckStub(`
export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { learner: z.number() },
}));
`)
=>
[
  "export default cardSchema(\"progress\", extendSchema(courseware.schemas.progress, {\n  «*»redeclares a base field«*»",
]
```

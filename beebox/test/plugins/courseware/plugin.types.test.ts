// # Courseware plugin: a box stub is typed against the published bases
//
// `beebox/plugins/courseware` resolves to `dist/plugins/courseware/plugin.d.ts`
// (the `types` target of the `./plugins/*` export). `definePlugin` infers the
// schemas map, so that declaration carries each base's precise
// `CardSchemaConfig<string, { ...fields }>` rather than an erased field map, and
// `extendSchema` in a box stub keeps the base's fields typed and rejects a
// redeclared one under `tsc`, before the runtime `RedeclaredFieldError`.
//
// The setup emits the declarations into `dist/` the way `pnpm build:cli` does
// (`tsc -p tsconfig.declarations.json`), then typechecks a stub written into a
// temp box whose `node_modules/beebox` points at this package, with the box's own
// scaffolded `tsconfig.json` (`extends: "beebox/tsconfig.base.json"`). The box
// resolves `beebox/*` through the package `exports` map, as an installed box does.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { execFile } from "node:child_process";
import { mkdir, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { typecheckProject } from "../../../src/lib/typescript/check.js";

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
  // The box's tsconfig names `node` and `react` types; a real box installs them. The native
  // checker looks in the box's own node_modules, so link this package's copies.
  const require = createRequire(join(PACKAGE_ROOT, "package.json"));
  await mkdir(box.path("node_modules/@types"), { recursive: true });
  for (const name of ["node", "react"]) {
    await symlink(dirname(require.resolve(`@types/${name}/package.json`)), box.path(`node_modules/@types/${name}`), "dir");
  }
  const stubPath = box.path(STUB);
  return typecheckProject(box.path("tsconfig.json")).map((d) => {
    if (d.fileName === undefined) return d.message;
    if (d.fileName !== stubPath) return `${d.fileName.slice(PACKAGE_ROOT.length)}: ${d.message}`;
    return `${d.lineText ?? ""}\n  ${d.message}`;
  });
}

// ## The README's stub and the documented extension compile
//
// The plain completion (`src/plugins/courseware/README.md`, Setup) and the
// extension `docs/plugins.md` shows (adding `mood`) both typecheck; the delta's
// `summarize` sees the base's `entries` with its element type and the added
// `mood`.
// The doctest gave each example 120s before a still-running notice.
void test("The plain completion (src/plugins/courseware/README.md, Setup) and the extens...", async (t) => {
  t.check(
    await typecheckStub(`
export const Plain = cardSchema("progress", courseware.schemas.progress);
export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({
    ...base,
    detail: \`\${card.entries?.filter((e) => e.level === "solid").length ?? 0} solid, mood \${card.mood ?? "unset"}\`,
  }),
}));
`),
    [],
  );
});

// ## The base's field types reach the stub
//
// A field neither side declares, a wrong value for a base enum, and a wrong type
// for a base field are each compile errors; `InferCardFields` on the completed
// schema carries the base fields with their types and the added one.
// The doctest gave each example 120s before a still-running notice.
void test("A field neither side declares, a wrong value for a base enum, and a wrong typ...", async (t) => {
  t.check(
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
`),
    [
    str`summarize: (card, base) => ({ ...base, detail: \`\${card.nope} \${card.entries?.[0]?.level === "fluent"}\` }),
  Property 'nope' does not exist on type 'CardFieldsOf<string, { course: ${any(String)}`,
    `summarize: (card, base) => ({ ...base, detail: \`\${card.nope} \${card.entries?.[0]?.level === "fluent"}\` }),
  This comparison appears to be unintentional because the types '"partial" | "solid" | "unfamiliar" | "working" | undefined' and '"fluent"' have no overlap.`,
    `const wrongLearner: Fields = { type: "progress", learner: 5, body: "" };
  Type 'number' is not assignable to type 'string'.`,
  ],
  );
});

// ## Redeclaring a base field fails under `tsc`
//
// The runtime `RedeclaredFieldError` (`test/cards/extend-schema.doctest.md`) is
// the fallback for a box running under type stripping; a typechecked box is
// told at compile time.
// The doctest gave each example 120s before a still-running notice.
void test("The runtime RedeclaredFieldError (test/cards/extend-schema.doctest.md) is the...", async (t) => {
  t.check(
    await typecheckStub(`
export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  fields: { learner: z.number() },
}));
`),
    [
    str`export default cardSchema("progress", extendSchema(courseware.schemas.progress, {
  ${any(String)}redeclares a base field${any(String)}`,
  ],
  );
});

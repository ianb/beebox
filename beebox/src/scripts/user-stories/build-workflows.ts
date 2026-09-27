/**
 * Transpile the `*.workflow.ts` sources to the `*.workflow.mjs` files the `Workflow` tool runs.
 *
 * The workflows are the one part of this pipeline that cannot be TypeScript at runtime: the tool
 * parses plain JavaScript, and gives the script no filesystem and no Node API, so it can import
 * nothing — not even a type. They are written as `.ts` anyway (so they are typechecked against
 * `workflow-globals.d.ts` like everything else here) and built into `beebox/dist/workflows/`,
 * with the rest of this package's generated output. **A `Workflow({scriptPath: …})` call will not
 * find a workflow until this has run.**
 *
 * `tsc` is the compiler here rather than esbuild for one specific reason: the tool requires the
 * script to open with `export const meta = {…}` as a literal, and esbuild rewrites that into
 * `var meta = {…}` with a trailing `export { meta }` in both bundle and transform modes. `tsc`
 * leaves the export declaration where it stands.
 *
 * Usage: pnpm exec tsx beebox/user-stories/pipeline/build-workflows.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

const HERE = import.meta.dirname;

/**
 * Generated workflows go to `dist/`, with the rest of this package's build output.
 *
 * Not beside their sources: a `.mjs` sitting in the source tree reads as a file
 * someone wrote and has to maintain, and the whole point of the `.ts` sources is
 * that nobody edits the JavaScript. `dist/` already means "generated, gitignored,
 * rebuild it" here.
 */
const OUT_DIR = resolve(HERE, "../../dist/workflows");

// A workflow's body runs inside an async function the runtime wraps around it, so it ends in a
// top-level `return` — a grammar error to a compiler reading the file as a module. The sources
// mark that one line `@ts-expect-error`, which is what makes `tsc --noEmit` over this directory
// pass; here the same diagnostic is dropped, since it is the form and not a mistake.
const TOP_LEVEL_RETURN = 1108;

const workflows = readdirSync(HERE)
  .filter((f) => f.endsWith(".workflow.ts"))
  .toSorted();

if (workflows.length === 0) {
  console.error(`No *.workflow.ts sources in ${HERE}.`);
  process.exit(1);
}

for (const file of workflows) {
  const source = readFileSync(join(HERE, file), "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      // The prose in these files is most of what they are — every prompt handed to a subagent
      // is a comment away from the code that sends it. Stripping comments would throw away the
      // reasoning behind the pipeline for a few hundred bytes.
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
  });

  const real = (diagnostics ?? []).filter((d) => d.code !== TOP_LEVEL_RETURN);
  if (real.length > 0) {
    for (const d of real) {
      console.error(`${file}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
    process.exit(1);
  }

  if (!outputText.startsWith("export const meta = {")) {
    // The tool reads `meta` off the top of the file as a literal before it runs anything. If a
    // compiler change ever moved or rewrote that declaration, the workflow would fail to load
    // with nothing here to say why.
    console.error(`${file}: emitted output does not open with \`export const meta = {\`.`);
    process.exit(1);
  }

  const out = file.replace(/\.ts$/, ".mjs");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, out), outputText);
  console.log(`dist/workflows/${out} (${outputText.split("\n").length} lines)`);
}

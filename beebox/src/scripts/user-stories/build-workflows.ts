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
 * leaves the export declaration where it stands. It runs as the TypeScript 7 binary with
 * `--noCheck`: 7.0 has no `transpileModule`, and a checked build would reject the top-level
 * `return` below.
 *
 * Usage: pnpm exec tsx beebox/src/scripts/user-stories/build-workflows.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { tscBinary } from "../../lib/typescript/tsc.js";

const HERE = import.meta.dirname;

/**
 * Generated workflows go to `dist/`, with the rest of this package's build output.
 *
 * Not beside their sources: a `.mjs` sitting in the source tree reads as a file
 * someone wrote and has to maintain, and the whole point of the `.ts` sources is
 * that nobody edits the JavaScript. `dist/` already means "generated, gitignored,
 * rebuild it" here.
 */
const OUT_DIR = resolve(HERE, "../../../dist/workflows");

// A workflow's body runs inside an async function the runtime wraps around it, so it ends in a
// top-level `return`. That is a grammar error (TS1108) only to the type checker; `--noCheck`
// skips it, and real syntax errors still fail the build. The sources mark the line
// `@ts-expect-error`, which is what makes `tsc --noEmit` over this directory pass.
const TSC_FLAGS = [
  "--ignoreConfig",
  "--noCheck",
  "--target", "es2023",
  "--module", "esnext",
  "--moduleResolution", "bundler",
  "--types", "",
  // The prose in these files is most of what they are — every prompt handed to a subagent
  // is a comment away from the code that sends it. Stripping comments would throw away the
  // reasoning behind the pipeline for a few hundred bytes.
  "--removeComments", "false",
  "--newLine", "lf",
  "--pretty", "false",
];

const workflows = readdirSync(HERE)
  .filter((f) => f.endsWith(".workflow.ts"))
  .toSorted();

if (workflows.length === 0) {
  console.error(`No *.workflow.ts sources in ${HERE}.`);
  process.exit(1);
}

const emitDir = mkdtempSync(join(tmpdir(), "bbx-workflows-"));
try {
  try {
    execFileSync(process.execPath, [tscBinary(), ...TSC_FLAGS, "--outDir", emitDir, ...workflows.map((f) => join(HERE, f))], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const out = e instanceof Error && "stdout" in e ? String(e.stdout) : "";
    console.error(out.trim() === "" ? String(e) : out.trim());
    process.exit(1);
  }

  for (const file of workflows) {
    const outputText = readFileSync(join(emitDir, file.replace(/\.ts$/, ".js")), "utf8");
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
} finally {
  rmSync(emitDir, { recursive: true, force: true });
}

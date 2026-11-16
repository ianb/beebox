// The sketch contract check (`checkSketchTypes`): one TypeScript program over
// the given sketch files, what they import, and one boundary file per sketch
// that checks its exports together against `TeaModule<D, M>` (`M` from `init`'s
// return type, `D` from `typeof params`). `cli run` runs it before it loads a
// sketch, and `gallery check` runs it once over every exercise.
//
// It uses the TypeScript 7 compiler through its API, in the compiler's Go
// process, loaded on first use. The config and the boundary files are virtual:
// the API's file system callbacks serve them, and every other read falls back
// to the disk. The program holds only the sketches, their imports, canvas-loop's
// root export and the ES2023 library files.
import { readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The virtual directory that holds the config and the boundary files. Nothing is written there. */
const VIRTUAL_DIR = join(PACKAGE_ROOT, ".sketch-check");
const CONFIG_PATH = join(VIRTUAL_DIR, "tsconfig.json");

/** One error the compiler reports for a sketch, its imports, or its exports. */
export interface SketchTypeError {
  /** Absolute path of the file the error is in: for an error in the exports, the sketch; undefined for a global error. */
  file: string | undefined;
  /** 1-based line and column of the error's start; undefined for a global error and for an error in the exports. */
  line: number | undefined;
  column: number | undefined;
  /** The TypeScript error code (TS2322 is 2322). */
  code: number;
  /** The message with its chained detail lines, indented as `tsc` prints them. */
  message: string;
}

/** The exports the boundary file checks, each on its own line so an error names the export. */
const CHECKED_EXPORTS = ['the export "init"', 'the export "update"', 'the export "draw"', "the params, canvas, sound or activity export"] as const;

/**
 * The boundary file for one sketch: its exports, typed by the contract. The
 * members are checked one by one so each error names its export; `M` and `D`
 * come from the sketch, so `update` and `draw` must agree with `init` on the
 * model and with `params` on the parameters.
 */
function boundarySource(importPath: string): string {
  return [
    'import type { CanvasSize, ParamsDecl, TeaModule } from "@ianbicking/canvas-loop";',
    `import * as sketch from ${JSON.stringify(importPath)};`,
    "type D = typeof sketch extends { readonly params: infer P extends ParamsDecl } ? P : Record<never, never>;",
    "type M = ReturnType<typeof sketch.init>;",
    // TeaModule's members are methods, whose parameters TypeScript compares both ways; as function types they are compared strictly.
    "type Fn<F> = F extends (...args: infer A) => infer R ? (...args: A) => R : never;",
    "type Contract = TeaModule<D, M>;",
    // These four lines match CHECKED_EXPORTS, in order.
    'export const init: Fn<Contract["init"]> = sketch.init;',
    'export const update: Fn<Contract["update"]> = sketch.update;',
    'export const draw: Fn<Contract["draw"]> = sketch.draw;',
    'export const rest: { params?: ParamsDecl; canvas?: CanvasSize; sound?: Fn<Contract["sound"]>; activity?: Fn<Contract["activity"]> } = sketch;',
    "",
  ].join("\n");
}
/** The 1-based line of the first checked export in every boundary file. */
const FIRST_CHECKED_LINE = boundarySource("").split("\n").findIndex((l) => l.startsWith("export const init")) + 1;

function importPathFor(sketch: string): string {
  const rel = relative(VIRTUAL_DIR, sketch).split(sep).join("/").replace(/\.tsx?$/u, ".js");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** The config: canvas-loop's own compiler options, the bundler resolution that `tsx` and esbuild use, no ambient types. */
function configSource(files: readonly string[]): string {
  return JSON.stringify({
    extends: join(PACKAGE_ROOT, "tsconfig.json"),
    compilerOptions: {
      noEmit: true,
      incremental: false,
      module: "preserve",
      moduleResolution: "bundler",
      types: [],
      paths: { "@ianbicking/canvas-loop": [join(PACKAGE_ROOT, "src/exports/core.ts")] },
    },
    include: [],
    files,
  });
}

interface Located {
  line: number;
  column: number;
}

function locate(text: string, pos: number): Located {
  const before = text.slice(0, pos);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: pos - lineStart + 1 };
}

interface ChainedDiagnostic {
  readonly text: string;
  readonly messageChain?: readonly ChainedDiagnostic[] | undefined;
}

function flatten(diagnostic: ChainedDiagnostic, depth: number): string {
  const lines = [`${"  ".repeat(depth)}${diagnostic.text}`];
  for (const child of diagnostic.messageChain ?? []) lines.push(flatten(child, depth + 1));
  return lines.join("\n");
}

/**
 * Type-check sketch files and each one's exports against the TEA contract.
 * Returns every error in the sketches, the files they import and their
 * exports, in one list; empty when all are clean. Paths may be relative to
 * the working directory.
 */
export async function checkSketchTypes(files: readonly string[]): Promise<SketchTypeError[]> {
  const sketches = files.map((f) => resolve(f));
  const virtual = new Map<string, string>();
  const boundaryOf = new Map<string, string>();
  for (const [i, sketch] of sketches.entries()) {
    const path = join(VIRTUAL_DIR, `contract-${i}.ts`);
    virtual.set(path, boundarySource(importPathFor(sketch)));
    boundaryOf.set(path, sketch);
  }
  virtual.set(CONFIG_PATH, configSource([...sketches, ...boundaryOf.keys()]));

  const { API, DiagnosticCategory } = await import("@typescript/native/unstable/sync");
  const api = new API({
    cwd: PACKAGE_ROOT,
    fs: {
      readFile: (name) => virtual.get(name),
      fileExists: (name) => (virtual.has(name) ? true : undefined),
      directoryExists: (name) => (name === VIRTUAL_DIR ? true : undefined),
      getAccessibleEntries: (name) => (name === VIRTUAL_DIR ? { files: [...virtual.keys()].map((p) => relative(VIRTUAL_DIR, p)), directories: [] } : undefined),
      realpath: (name) => (virtual.has(name) || name === VIRTUAL_DIR ? name : undefined),
    },
  });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [CONFIG_PATH] });
    try {
      const project = snapshot.getProject(CONFIG_PATH);
      if (project === undefined) throw new CliError({ detail: `TypeScript did not load the sketch check's program (${CONFIG_PATH})` });
      const { program } = project;
      const diagnostics = [
        ...program.getConfigFileParsingDiagnostics(),
        ...program.getProgramDiagnostics(),
        ...program.getSyntacticDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program.getSemanticDiagnostics(),
      ].filter((d) => d.category === DiagnosticCategory.Error);
      const texts = new Map<string, string>();
      const textOf = (file: string): string => {
        const known = virtual.get(file) ?? texts.get(file);
        if (known !== undefined) return known;
        const read = readFileSync(file, "utf8");
        texts.set(file, read);
        return read;
      };
      return diagnostics.map((d): SketchTypeError => {
        const message = flatten(d, 0);
        const file = d.fileName;
        if (file === undefined) return { file: undefined, line: undefined, column: undefined, code: d.code, message };
        const sketch = boundaryOf.get(file);
        if (sketch !== undefined) {
          const which = CHECKED_EXPORTS[locate(textOf(file), d.pos).line - FIRST_CHECKED_LINE] ?? "an export";
          return { file: sketch, line: undefined, column: undefined, code: d.code, message: `${which} does not fit the sketch contract (TeaModule, with the model init returns and the declared params): ${message}` };
        }
        const at = locate(textOf(file), d.pos);
        return { file, line: at.line, column: at.column, code: d.code, message };
      });
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

/** One error as `file:line:col - error TS1234: message`, the file relative to `cwd` when it is inside it. */
export function formatSketchTypeError(error: SketchTypeError, cwd: string): string {
  const rel = error.file === undefined ? undefined : relative(cwd, error.file);
  const shown = rel === undefined || rel.startsWith("..") ? error.file : rel;
  const where = shown === undefined ? "" : `${shown}${error.line === undefined ? "" : `:${error.line}:${error.column ?? 1}`} - `;
  return `${where}error TS${error.code}: ${error.message}`;
}

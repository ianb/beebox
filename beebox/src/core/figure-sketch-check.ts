/**
 * The sketch contract check for a canvas-loop figure's entry, shared by `bbx
 * figure run` and the figure card's module route (canvas-loop box figures
 * plan, need 10). esbuild strips types, so without it a wrong style value (a
 * `cap` canvas-loop does not have) would draw with no error.
 *
 * It type-checks the entry, the files it imports, and its exports against
 * canvas-loop's TEA contract with `checkSketchTypes`. DOM types are on: the
 * entry's default export runs in a browser. That export, the figure factory,
 * takes the host's wrapped library and figure context, for which a box has no
 * type to import, so implicit-`any` parameters from the `export default` line
 * on are not errors. `@/…` imports resolve from the box root, as the bundler
 * resolves them (`webapp/views/compiler/box-imports.ts`).
 */
import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";

/** Where a packed install keeps canvas-loop's declarations (`tsconfig.declarations.canvas-loop.json`). */
const SHIPPED_TYPES = path.join(PACKAGE_ROOT, "dist", "canvas-loop");

/** No canvas-loop types to check against: neither the workspace source nor the shipped declarations. */
export class FigureCheckUnavailableError extends Error {
  name = "FigureCheckUnavailableError";
  constructor(options: { cause: unknown }) {
    super(`cannot type-check the sketch: this engine install has neither canvas-loop's source nor its shipped declarations (${SHIPPED_TYPES})`, { cause: options.cause });
  }
}

/**
 * canvas-loop's package directory for the check: the workspace package when
 * it resolves (the dev checkout and the server), else the declarations a
 * packed install ships. The CLI bundle inlines canvas-loop, so its own module
 * URL does not point into the package.
 */
function canvasLoopRoot(): string {
  try {
    // The root export is `src/exports/core.ts`.
    return path.resolve(path.dirname(createRequire(path.join(PACKAGE_ROOT, "package.json")).resolve("@ianbicking/canvas-loop")), "..", "..");
  } catch (error) {
    if (existsSync(path.join(SHIPPED_TYPES, "tsconfig.json"))) return SHIPPED_TYPES;
    throw new FigureCheckUnavailableError({ cause: error });
  }
}

/** TS7006 and TS7031: a parameter, or a destructured one, with an implicit `any` type. */
const IMPLICIT_ANY_PARAM = new Set([7006, 7031]);

/** The line canvas-loop adds to a type error that names a removed call: `<call> was removed: <replacement>`. */
const REMOVED_LINE = /^\s*(\S.* was removed: .*)$/mu;

/** The check's outcome: clean, or the errors as text plus the first removed call any of them names. */
export type FigureSketchCheck =
  | { ok: true }
  | {
    ok: false;
    /** One `file:line:col - error TS…` line per error, paths relative to the box. */
    lines: string[];
    /** The errors in the entry itself (and any global one): `lines` without `shared`. */
    own: string[];
    /** The errors in files other than the entry (shared code, a helper), by box-relative file: a whole-box run prints each once. */
    shared: Array<{ file: string; lines: string[] }>;
    /** `v.cache was removed: use v.picture …`, when an error names a call the scene API removed: the sketch was written for the earlier canvas-loop. */
    removed: string | undefined;
  };

/** The settings a box figure is checked with: DOM types, and `@/…` from the box root. */
function boxOptions(boxRoot: string): { packageRoot: string; dom: true; paths: Record<string, string[]> } {
  return { packageRoot: canvasLoopRoot(), dom: true, paths: { "@/*": [path.join(boxRoot, "*")] } };
}

/** Type-check a canvas-loop figure's entry (absolute path) against the sketch contract. */
export async function checkFigureSketch(boxRoot: string, entry: string): Promise<FigureSketchCheck> {
  const { checkSketchTypes, formatSketchTypeError } = await import("@ianbicking/canvas-loop/sketch-check");
  const factoryLine = (await fs.readFile(entry, "utf8")).split("\n").findIndex((line) => /^export default\b/u.test(line)) + 1;
  const inFactory = (e: { file: string | undefined; line: number | undefined; code: number }): boolean =>
    factoryLine > 0 && e.file === entry && IMPLICIT_ANY_PARAM.has(e.code) && (e.line ?? 0) >= factoryLine;
  const errors = (await checkSketchTypes([entry], boxOptions(boxRoot))).filter((e) => !inFactory(e));
  if (errors.length === 0) return { ok: true };
  const removed = errors.map((e) => REMOVED_LINE.exec(e.message)?.[1]).find((line) => line !== undefined);
  const own: string[] = [];
  const shared = new Map<string, string[]>();
  for (const e of errors) {
    const line = formatSketchTypeError(e, boxRoot);
    if (e.file === undefined || e.file === entry) own.push(line);
    else {
      const file = path.relative(boxRoot, e.file);
      shared.set(file, [...(shared.get(file) ?? []), line]);
    }
  }
  return { ok: false, lines: errors.map((e) => formatSketchTypeError(e, boxRoot)), own, shared: [...shared].map(([file, lines]) => ({ file, lines })), removed };
}

/**
 * Type-check shared code on its own (absolute paths), with the settings a
 * figure's imports get; no sketch contract. One `file:line:col - error TS…`
 * line per error.
 */
export async function checkFigureHelpers(boxRoot: string, files: readonly string[]): Promise<string[]> {
  const { checkSketchTypes, formatSketchTypeError } = await import("@ianbicking/canvas-loop/sketch-check");
  return (await checkSketchTypes([], { ...boxOptions(boxRoot), helpers: files })).map((e) => formatSketchTypeError(e, boxRoot));
}

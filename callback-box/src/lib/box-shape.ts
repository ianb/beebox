/**
 * The layout predicate: given a box root, resolve where its package root
 * lives. Every box is shapeVersion 2 (the package layout): the box root is a
 * `content/` directory nested inside a package, and the package root is its
 * parent. A marker without `shapeVersion >= 2` predates that layout and is a
 * hard error (see `docs/box-layout.md`).
 *
 * This is the single layout resolver described in
 * `docs/implemented-plans/boxes-as-packages-v2.md` ("The box repository"): every other
 * consumer (schema registry, view compiler, trick runner, agent guide) reads
 * this predicate instead of re-deriving the layout itself.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "./error-guards.js";

const BOX_MARKER = ".cb-box";

/** The lowest shape version this build of callback-box understands. */
const MIN_KNOWN_SHAPE_VERSION = 2;

/** The highest shape version this build of callback-box understands. */
const MAX_KNOWN_SHAPE_VERSION = 2;

export class BoxShapeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BoxShapeError";
  }
}

export interface BoxShape {
  /** The shape version declared by the box's `.cb-box` marker (always >= 2). */
  shapeVersion: number;
  /** The operational root — where `.cb-box`, `box/`, `config/`, etc. live. */
  boxRoot: string;
  /** The package root — where `package.json`/`node_modules`/`src/` live. The
   * parent of `boxRoot` (which is the package's `content/` directory). */
  packageRoot: string;
}

const boxMarkerSchema = z.object({ shapeVersion: z.number().optional() });
type BoxMarker = z.infer<typeof boxMarkerSchema>;

const packageJsonShapeSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
type PackageJsonShape = z.infer<typeof packageJsonShapeSchema>;

/**
 * Determine a box's physical layout.
 *
 * Reads the `.cb-box` marker at `boxRoot`. Every box is shapeVersion 2 (the
 * package layout): the box root is a `content/` directory nested inside a
 * package, so the package root is `boxRoot`'s parent. This is validated
 * fail-closed — the parent must declare a `callback-box` dependency, or
 * box-owned code could silently resolve against the wrong `node_modules`. A
 * marker whose `shapeVersion` is absent or `< 2` predates this layout and is
 * a hard error (see `docs/box-layout.md`).
 *
 * @param boxRoot - The box root directory (contains `.cb-box`)
 * @throws BoxShapeError if the marker predates the v2 package layout
 *   (`shapeVersion` absent or `< 2`), if the box's parent doesn't declare
 *   `callback-box`, or if the marker declares a shape version newer than this
 *   build understands
 */
export async function getBoxShape(boxRoot: string): Promise<BoxShape> {
  const resolvedRoot = path.resolve(boxRoot);
  const marker = await readBoxMarker(resolvedRoot);
  const { shapeVersion } = marker;

  if (shapeVersion === undefined || shapeVersion < MIN_KNOWN_SHAPE_VERSION) {
    throw new BoxShapeError(
      `Box at ${resolvedRoot} ${
        shapeVersion === undefined
          ? "has a .cb-box marker with no shapeVersion field"
          : `declares shapeVersion ${shapeVersion}`
      }, which predates the v2 package layout (minimum: ${MIN_KNOWN_SHAPE_VERSION}). ` +
        "See docs/box-layout.md."
    );
  }

  if (shapeVersion > MAX_KNOWN_SHAPE_VERSION) {
    throw new BoxShapeError(
      `Box at ${resolvedRoot} declares shapeVersion ${shapeVersion}, which this ` +
        `build of callback-box doesn't understand (max known: ${MAX_KNOWN_SHAPE_VERSION}). ` +
        "The box requires a newer callback-box."
    );
  }

  const packageRoot = path.dirname(resolvedRoot);
  await requireCallbackBoxDependency(packageRoot, resolvedRoot);
  return { shapeVersion, boxRoot: resolvedRoot, packageRoot };
}

/** The result of a tolerant shape lookup: a resolved shape, or "no box here." */
export type BoxShapeLookup =
  | { found: true; shape: BoxShape }
  | { found: false; boxRoot: string };

/**
 * Like `getBoxShape`, but returns a discriminated result instead of throwing
 * when the path has no `.cb-box` marker (ENOENT). For the genuinely
 * arbitrary-path callers (the dev CSP tools that walk every subdir of
 * `~/src/boxes`, the audit box guard, box-schema rebuild) that must tolerate
 * "not a box" and only need the `boxRoot` they passed. It NEVER fabricates a
 * `BoxShape`: a marker that predates v2, a malformed marker (`SyntaxError`
 * from `JSON.parse`), an unreadable one (`EACCES`), a v2 box with a broken
 * parent `package.json`, and any other IO failure are real problems and still
 * throw.
 */
export async function getBoxShapeIfPresent(boxRoot: string): Promise<BoxShapeLookup> {
  const resolvedRoot = path.resolve(boxRoot);
  try {
    return { found: true, shape: await getBoxShape(resolvedRoot) };
  } catch (e) {
    // Only a missing `.cb-box` marker (ENOENT from readBoxMarker's readFile)
    // means "not a box"; everything else — a v2-predating/malformed marker
    // (BoxShapeError), EACCES, other IO — is a real error we must surface.
    if (errnoCode(e) === "ENOENT") return { found: false, boxRoot: resolvedRoot };
    throw e;
  }
}

/**
 * Resolve a path that may be a v2 box's PACKAGE root OR its operational
 * (`content/`) root to the operational root — where box data and the
 * `.callback-box/` dir live. Dev tools that scan `~/src/boxes/*` are handed
 * package roots, whose `.cb-box` marker lives one level down in `content/`.
 * Returns the resolved input unchanged when neither the path nor its `content/`
 * child is a box. Malformed/unreadable markers still throw (via
 * `getBoxShapeIfPresent`).
 */
export async function resolveOperationalRoot(inputPath: string): Promise<string> {
  const direct = await getBoxShapeIfPresent(inputPath);
  if (direct.found) return direct.shape.boxRoot;
  const nested = await getBoxShapeIfPresent(path.join(path.resolve(inputPath), "content"));
  if (nested.found) return nested.shape.boxRoot;
  return path.resolve(inputPath);
}

async function readBoxMarker(boxRoot: string): Promise<BoxMarker> {
  const markerPath = path.join(boxRoot, BOX_MARKER);
  const raw = await fs.readFile(markerPath, "utf-8");
  if (raw.trim() === "") {
    // An empty marker file has no fields; the caller treats a missing
    // `shapeVersion` as a hard error (predates the v2 package layout).
    return {};
  }
  const parsed = boxMarkerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new BoxShapeError(
      "Box marker at " + markerPath + " is malformed (see cause).",
      { cause: parsed.error }
    );
  }
  return parsed.data;
}

async function requireCallbackBoxDependency(packageRoot: string, boxRoot: string): Promise<void> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  let pkg: PackageJsonShape;
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    pkg = packageJsonShapeSchema.parse(JSON.parse(raw));
  } catch (e) {
    throw new BoxShapeError(
      `Box at ${boxRoot} declares shapeVersion 2+ (package layout), but its parent ` +
        `${packageRoot} has no readable package.json. Expected a package.json there ` +
        `declaring a "callback-box" dependency. (${describeError(e)})`
    );
  }

  const declaresCallbackBox =
    "callback-box" in (pkg.dependencies ?? {}) || "callback-box" in (pkg.devDependencies ?? {});
  if (!declaresCallbackBox) {
    throw new BoxShapeError(
      `Box at ${boxRoot} declares shapeVersion 2+ (package layout), but ${packageJsonPath} ` +
        'doesn\'t declare a "callback-box" dependency (checked dependencies and devDependencies).'
    );
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The three code directories a box's engine-facing loaders read: schemas, views, tricks. */
export interface BoxCodePaths {
  schemasDir: string;
  viewsDir: string;
  tricksDir: string;
}

/**
 * Resolve a box's code directories from its shape. A box keeps code at the
 * package root's `src/` (see "The box repository" in
 * `docs/implemented-plans/boxes-as-packages-v2.md`) — everything left in
 * `boxRoot` (the operational `content/` root) is operational data.
 */
/**
 * For a v2 box, `config/schemas/` inside the operational root (`boxRoot`) is
 * a legacy location — schemas now live in `src/schemas/` at the package
 * root (`boxCodePaths`' `schemasDir`). A stray `*.ts` file left there is
 * invisible to the schema loader (which only reads the v2 path) and to the
 * PostToolUse validate hook (`config/schemas/*.ts` isn't a card path, so the
 * hook exits 0 silently) — without this check a misplaced schema never
 * loads and nothing says why. Returns the misplaced file names (empty when
 * nothing is misplaced).
 */
export async function findLegacySchemaFiles(shape: BoxShape): Promise<string[]> {
  const legacyDir = path.join(shape.boxRoot, "config/schemas");
  let entries: string[];
  try {
    entries = await fs.readdir(legacyDir);
  } catch (_e) {
    // Missing (or unreadable) legacy dir is the expected, common case for a
    // v2 box that never had one — nothing actionable to log.
    return [];
  }
  return entries.filter((f) => f.endsWith(".ts") && !f.startsWith(".")).toSorted();
}

/**
 * Human-readable error for `findLegacySchemaFiles` results — shared by `cb
 * validate` and `cb status` so the two surfaces say exactly the same thing.
 */
export function describeLegacySchemaFiles(shape: BoxShape, files: string[]): string {
  const list = files.map((f) => `config/schemas/${f}`).join(", ");
  return (
    `Found ${String(files.length)} schema file(s) in the legacy location: ${list}. ` +
    "This box uses the package layout — schemas live in src/schemas/ at the " +
    `package root now (${shape.packageRoot}). Move them there.`
  );
}

export function boxCodePaths(shape: BoxShape): BoxCodePaths {
  return {
    schemasDir: path.join(shape.packageRoot, "src/schemas"),
    viewsDir: path.join(shape.packageRoot, "src/views"),
    tricksDir: path.join(shape.packageRoot, "src/tricks"),
  };
}

/**
 * `boxCodePaths`, expressed as POSIX-style relative paths from `shape.boxRoot`
 * — the operating agent's cwd. Agent-facing prose (the generated agent guide)
 * needs "how do I reach this from where I'm sitting," not an absolute path
 * that embeds this machine's temp/home directory — the `../src/...` climb out
 * of `content/` into the package root.
 */
export function boxCodePathsRelativeToBoxRoot(shape: BoxShape): BoxCodePaths {
  const paths = boxCodePaths(shape);
  const toRelative = (absolute: string): string =>
    path.relative(shape.boxRoot, absolute).split(path.sep).join("/");
  return {
    schemasDir: toRelative(paths.schemasDir),
    viewsDir: toRelative(paths.viewsDir),
    tricksDir: toRelative(paths.tricksDir),
  };
}

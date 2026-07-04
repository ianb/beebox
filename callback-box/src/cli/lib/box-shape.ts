/**
 * The bilingual layout predicate: given a box root, determine which physical
 * layout it uses (legacy — the box root IS the package root — or v2 — the
 * box root is a `content/` directory nested inside a package) and where its
 * package root lives.
 *
 * This is the entire bilingual-transition switch described in
 * `docs/plans/boxes-as-packages-v2.md` ("The box repository"): every other
 * consumer (schema registry, view compiler, trick runner, agent guide) reads
 * this predicate instead of re-deriving the layout itself.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const BOX_MARKER = ".cb-box";

/** The shape a box's marker declares when the field is absent (every existing box). */
const LEGACY_SHAPE_VERSION = 1;

/** The highest shape version this build of callback-box understands. */
const MAX_KNOWN_SHAPE_VERSION = 2;

export class BoxShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxShapeError";
  }
}

export interface BoxShape {
  /** The shape version declared by (or inferred for) the box's `.cb-box` marker. */
  shapeVersion: number;
  /** The operational root — where `.cb-box`, `box/`, `config/`, etc. live. */
  boxRoot: string;
  /** The package root — where `package.json`/`node_modules`/`src/` live. Equals
   * `boxRoot` for a legacy (shapeVersion 1) box. */
  packageRoot: string;
}

interface BoxMarker {
  shapeVersion?: number;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Determine a box's physical layout.
 *
 * Reads the `.cb-box` marker at `boxRoot`. A missing `shapeVersion` field
 * means shape 1 (every box created before this plan). Shape 1's package
 * root is the box root itself. Shape 2 and above nest the box root inside a
 * package directory (`boxRoot`'s parent); this is validated fail-closed —
 * the parent must declare a `callback-box` dependency, or box-owned code
 * could silently resolve against the wrong `node_modules`.
 *
 * @param boxRoot - The box root directory (contains `.cb-box`)
 * @throws BoxShapeError if a v2+ box's parent doesn't declare `callback-box`,
 *   or if the marker declares a shape version newer than this build understands
 */
export async function getBoxShape(boxRoot: string): Promise<BoxShape> {
  const resolvedRoot = path.resolve(boxRoot);
  const marker = await readBoxMarker(resolvedRoot);
  const shapeVersion = marker.shapeVersion ?? LEGACY_SHAPE_VERSION;

  if (shapeVersion > MAX_KNOWN_SHAPE_VERSION) {
    throw new BoxShapeError(
      `Box at ${resolvedRoot} declares shapeVersion ${shapeVersion}, which this ` +
        `build of callback-box doesn't understand (max known: ${MAX_KNOWN_SHAPE_VERSION}). ` +
        "The box requires a newer callback-box."
    );
  }

  if (shapeVersion === LEGACY_SHAPE_VERSION) {
    return { shapeVersion, boxRoot: resolvedRoot, packageRoot: resolvedRoot };
  }

  const packageRoot = path.dirname(resolvedRoot);
  await requireCallbackBoxDependency(packageRoot, resolvedRoot);
  return { shapeVersion, boxRoot: resolvedRoot, packageRoot };
}

/**
 * Like `getBoxShape`, but tolerates a missing `.cb-box` marker by falling
 * back to the legacy shape instead of throwing. A "boxRoot" reaching a
 * shape-aware consumer isn't always a real, fully-initialized box — plenty
 * of test fixtures and degenerate/nonexistent paths pass through code that
 * has always tolerated that — so a bare missing-marker shouldn't newly
 * crash what used to be a no-op. A genuine `BoxShapeError` (marker present,
 * but a v2+ box whose parent package.json is broken, or an unknown future
 * shapeVersion) is a real problem and still propagates.
 */
export async function getBoxShapeOrLegacyFallback(boxRoot: string): Promise<BoxShape> {
  const resolvedRoot = path.resolve(boxRoot);
  try {
    return await getBoxShape(resolvedRoot);
  } catch (e) {
    if (e instanceof BoxShapeError) throw e;
    return { shapeVersion: LEGACY_SHAPE_VERSION, boxRoot: resolvedRoot, packageRoot: resolvedRoot };
  }
}

async function readBoxMarker(boxRoot: string): Promise<BoxMarker> {
  const markerPath = path.join(boxRoot, BOX_MARKER);
  const raw = await fs.readFile(markerPath, "utf-8");
  if (raw.trim() === "") {
    // Some boxes (e.g. doctest fixtures) write an empty marker file — treat
    // it the same as a legacy marker with no fields set.
    return {};
  }
  return JSON.parse(raw) as BoxMarker;
}

async function requireCallbackBoxDependency(packageRoot: string, boxRoot: string): Promise<void> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  let pkg: PackageJsonShape;
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    pkg = JSON.parse(raw) as PackageJsonShape;
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
 * Resolve a box's code directories from its shape. Legacy (shapeVersion 1)
 * boxes keep code inside the operational root (`boxRoot`); shapeVersion 2
 * boxes moved code out to the package root's `src/` (see "The box
 * repository" in `docs/plans/boxes-as-packages-v2.md`) — everything else
 * left in `boxRoot` is operational data.
 */
/**
 * For a v2 box, `config/schemas/` inside the operational root (`boxRoot`) is
 * a legacy location — schemas now live in `src/schemas/` at the package
 * root (`boxCodePaths`' `schemasDir`). A stray `*.ts` file left there is
 * invisible to the schema loader (which only reads the v2 path) and to the
 * PostToolUse validate hook (`config/schemas/*.ts` isn't a card path, so the
 * hook exits 0 silently) — without this check a misplaced schema never
 * loads and nothing says why. Returns the misplaced file names (empty for a
 * v1 box, or when nothing is misplaced).
 */
export async function findLegacySchemaFiles(shape: BoxShape): Promise<string[]> {
  if (shape.shapeVersion === LEGACY_SHAPE_VERSION) return [];
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
  if (shape.shapeVersion === LEGACY_SHAPE_VERSION) {
    return {
      schemasDir: path.join(shape.boxRoot, "config/schemas"),
      viewsDir: path.join(shape.boxRoot, "views"),
      tricksDir: path.join(shape.boxRoot, "tricks"),
    };
  }
  return {
    schemasDir: path.join(shape.packageRoot, "src/schemas"),
    viewsDir: path.join(shape.packageRoot, "src/views"),
    tricksDir: path.join(shape.packageRoot, "src/tricks"),
  };
}

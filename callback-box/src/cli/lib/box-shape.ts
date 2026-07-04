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

/**
 * The layout predicate: given a box root, resolve its shape. shapeVersion 3
 * (the one-root layout — `docs/plans/one-root-box-layout.md`) collapses the
 * old two-root package layout (package root + nested `content/` operational
 * root) into ONE root: `.beebox/box.json`, `package.json`, `src/`, and every
 * underscore-prefixed operational area (`_content/`, `_config/`, …) all live
 * at the same directory. A marker whose `shapeVersion` predates 3 (or is
 * absent) is a v2 box and gets a migration-pointing hard error — see
 * `docs/box-layout.md`.
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
import { LEGACY_PACKAGE_NAME, migrateBoxState } from "./state-migration.js";
import {
  BoxShapeError,
  V2PackageRootError,
  PreV3ShapeError,
  NewerShapeRequiredError,
  NotABoxError,
  UnreadablePackageJsonError,
  MissingBeeBoxDependencyError,
} from "./box-shape-errors.js";

export { BoxShapeError } from "./box-shape-errors.js";

const BOX_MARKER = ".beebox/box.json";

/** The lowest shape version this build of beebox understands. */
const MIN_KNOWN_SHAPE_VERSION = 3;

/** The highest shape version this build of beebox understands. */
const MAX_KNOWN_SHAPE_VERSION = 3;

export interface BoxShape {
  /** The shape version declared by the box's `.beebox/box.json` marker (always >= 3). */
  shapeVersion: number;
  /** The box root — the ONE root; `.beebox/box.json`, `package.json`, `src/`,
   * and every `_`-prefixed operational area all live here. */
  boxRoot: string;
  /**
   * @deprecated Alias for `boxRoot`. shapeVersion 3 has one root, so this is
   * always identical to `boxRoot` — kept only so the ~60 call sites that
   * read `shape.packageRoot` for code paths (`src/schemas`, etc.) keep
   * compiling and stay correct. A later track deletes this field and those
   * call sites switch to `boxRoot`.
   */
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
 * Reads the `.beebox/box.json` marker at `boxRoot` (the one root: package.json,
 * src/, and every operational `_`-area). A marker whose `shapeVersion` is
 * absent or `< 3` predates the one-root layout — including the common case
 * of a v2 PACKAGE root (no marker of its own, but one at `<boxRoot>/content`)
 * or a v2 CONTENT root (basename `content`, marker `shapeVersion: 2`) — and
 * gets a `bbx migrate`-pointing hard error.
 *
 * @param boxRoot - The box root directory (contains `.beebox/box.json`)
 * @throws BoxShapeError if the marker predates the one-root layout
 *   (`shapeVersion` absent or `< 3`), if the box doesn't declare a `beebox`
 *   dependency in its own `package.json`, or if the marker declares a shape
 *   version newer than this build understands
 */
export async function getBoxShape(boxRoot: string): Promise<BoxShape> {
  const resolvedRoot = path.resolve(boxRoot);
  await migrateBoxState(resolvedRoot);

  let marker: BoxMarker;
  try {
    marker = await readBoxMarker(resolvedRoot);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    // No marker at this path. A v2 PACKAGE root has its marker one level
    // down, at `<resolvedRoot>/content` — worth naming specifically rather
    // than reporting "not a box." Genuine "nothing box-like here" (neither
    // marker present) is re-thrown as-is; `getBoxShapeIfPresent` recognizes
    // the ENOENT and reports "not found" rather than surfacing it.
    const nestedMarker = await readBoxMarkerTolerant(path.join(resolvedRoot, "content"));
    if (nestedMarker !== null) throw new V2PackageRootError(resolvedRoot);
    throw e;
  }

  const { shapeVersion } = marker;
  if (shapeVersion === undefined || shapeVersion < MIN_KNOWN_SHAPE_VERSION) {
    throw new PreV3ShapeError(resolvedRoot, shapeVersion);
  }

  if (shapeVersion > MAX_KNOWN_SHAPE_VERSION) {
    throw new NewerShapeRequiredError(resolvedRoot, {
      shapeVersion,
      maxKnownShapeVersion: MAX_KNOWN_SHAPE_VERSION,
    });
  }

  await requireBeeBoxDependency(resolvedRoot);
  return { shapeVersion, boxRoot: resolvedRoot, packageRoot: resolvedRoot };
}

/** The result of a tolerant shape lookup: a resolved shape, or "no box here." */
export type BoxShapeLookup =
  | { found: true; shape: BoxShape }
  | { found: false; boxRoot: string };

/**
 * Like `getBoxShape`, but returns a discriminated result instead of throwing
 * when the path has no `.beebox/box.json` marker at all (ENOENT, and no v2
 * marker one level down at `content/` either). For the genuinely
 * arbitrary-path callers (the dev CSP tools that walk every subdir of
 * `~/src/boxes`, the audit box guard, box-schema rebuild) that must tolerate
 * "not a box" and only need the `boxRoot` they passed. It NEVER fabricates a
 * `BoxShape`: a marker that predates v3 (a real BoxShapeError, migration
 * pointer included), a malformed marker (`SyntaxError` from `JSON.parse`),
 * an unreadable one (`EACCES`), a box with a broken `package.json`, and any
 * other IO failure are real problems and still throw.
 */
export async function getBoxShapeIfPresent(boxRoot: string): Promise<BoxShapeLookup> {
  const resolvedRoot = path.resolve(boxRoot);
  try {
    return { found: true, shape: await getBoxShape(resolvedRoot) };
  } catch (e) {
    // Only "no marker here, and no v2 marker at content/ either" means "not
    // a box" — that case reaches here as the raw ENOENT from `readBoxMarker`
    // (re-thrown as-is by `getBoxShape`, not wrapped). Everything else (a
    // v2-predating marker, a malformed marker, EACCES, other IO) is a real
    // error — a `BoxShapeError` (migration pointer included) or anything
    // else — that we must surface.
    if (errnoCode(e) === "ENOENT") {
      return { found: false, boxRoot: resolvedRoot };
    }
    throw e;
  }
}

/**
 * Resolve a path that should be a v3 box root. Returns the resolved root
 * when its marker checks out; throws the migration-pointing `BoxShapeError`
 * when the path (or its `content/` child) is a v2 shape; returns the
 * resolved input unchanged when nothing box-like is present at all — the
 * same tolerant contract the dev-tool callers (`csp-digest.ts`,
 * `csp-report.ts`, `audit-box.ts`, `secrets/migrate.ts`) relied on from the
 * old `resolveOperationalRoot`.
 */
export async function resolveBoxRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const direct = await getBoxShapeIfPresent(resolved);
  if (direct.found) return direct.shape.boxRoot;
  // getBoxShapeIfPresent already re-threw a v2-shape error above if this
  // path itself carries a v2 marker or a nested content/ marker; reaching
  // here means truly nothing box-like is at `resolved`.
  return resolved;
}

/**
 * Strict counterpart to `resolveBoxRoot`: throws `BoxShapeError` when the
 * resolved path has no v3 marker, instead of passing the path through
 * unchanged. For callers (the hub, `bbx serve`) where a configured box path
 * that resolves to "not a box" must fail loudly, not silently continue with
 * a directory that turns out not to be one.
 */
export async function requireBoxRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const lookup = await getBoxShapeIfPresent(resolved);
  if (lookup.found) return lookup.shape.boxRoot;
  throw new NotABoxError(resolved);
}

/** Read the marker at `boxRoot`, tolerating ENOENT as "no marker" (null). A
 * malformed marker still throws. */
async function readBoxMarkerTolerant(boxRoot: string): Promise<BoxMarker | null> {
  try {
    return await readBoxMarker(boxRoot);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

async function readBoxMarker(boxRoot: string): Promise<BoxMarker> {
  const markerPath = path.join(boxRoot, BOX_MARKER);
  const raw = await fs.readFile(markerPath, "utf-8");
  if (raw.trim() === "") {
    // An empty marker file has no fields; the caller treats a missing
    // `shapeVersion` as a hard error (predates the one-root layout).
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

async function requireBeeBoxDependency(boxRoot: string): Promise<void> {
  const packageJsonPath = path.join(boxRoot, "package.json");
  let pkg: PackageJsonShape;
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    pkg = packageJsonShapeSchema.parse(JSON.parse(raw));
  } catch (e) {
    throw new UnreadablePackageJsonError(boxRoot, { packageJsonPath, cause: e });
  }

  // Existing boxes can reach this boundary before their package manifest is
  // upgraded. Accept the retired dependency name only as a compatibility
  // read; all newly scaffolded packages use `beebox`.
  const declaresBeeBox =
    "beebox" in (pkg.dependencies ?? {}) ||
    "beebox" in (pkg.devDependencies ?? {}) ||
    LEGACY_PACKAGE_NAME in (pkg.dependencies ?? {}) ||
    LEGACY_PACKAGE_NAME in (pkg.devDependencies ?? {});
  if (!declaresBeeBox) {
    throw new MissingBeeBoxDependencyError(boxRoot, packageJsonPath);
  }
}

/** The three code directories a box's engine-facing loaders read: schemas, views, tricks. */
export interface BoxCodePaths {
  schemasDir: string;
  viewsDir: string;
  tricksDir: string;
}

/**
 * For a box, `_config/schemas/` is a legacy location — schemas now live in
 * `src/schemas/` at the box root (`boxCodePaths`' `schemasDir`). A stray
 * `*.ts` file left there is invisible to the schema loader (which only reads
 * the current path) and to the PostToolUse validate hook (`_config/schemas/*.ts`
 * isn't a card path, so the hook exits 0 silently) — without this check a
 * misplaced schema never loads and nothing says why. Returns the misplaced
 * file names (empty when nothing is misplaced).
 */
export async function findLegacySchemaFiles(shape: BoxShape): Promise<string[]> {
  const legacyDir = path.join(shape.boxRoot, "_config/schemas");
  let entries: string[];
  try {
    entries = await fs.readdir(legacyDir);
  } catch (_e) {
    // Missing (or unreadable) legacy dir is the expected, common case for a
    // box that never had one — nothing actionable to log.
    return [];
  }
  return entries.filter((f) => f.endsWith(".ts") && !f.startsWith(".")).toSorted();
}

/**
 * Human-readable error for `findLegacySchemaFiles` results — shared by `bbx
 * validate` and `bbx status` so the two surfaces say exactly the same thing.
 */
export function describeLegacySchemaFiles(shape: BoxShape, files: string[]): string {
  const list = files.map((f) => `_config/schemas/${f}`).join(", ");
  return (
    `Found ${String(files.length)} schema file(s) in the legacy location: ${list}. ` +
    `Schemas live in src/schemas/ at the box root now (${shape.boxRoot}). Move them there.`
  );
}

export function boxCodePaths(shape: BoxShape): BoxCodePaths {
  return {
    schemasDir: path.join(shape.boxRoot, "src/schemas"),
    viewsDir: path.join(shape.boxRoot, "src/views"),
    tricksDir: path.join(shape.boxRoot, "src/tricks"),
  };
}

/**
 * `boxCodePaths`, expressed as POSIX-style relative paths from `shape.boxRoot`
 * — the operating agent's cwd. Agent-facing prose (the generated agent guide)
 * needs "how do I reach this from where I'm sitting," not an absolute path
 * that embeds this machine's temp/home directory. In shapeVersion 3 this is
 * just `src/schemas` etc. — no `../` climb, since code and content share one
 * root.
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

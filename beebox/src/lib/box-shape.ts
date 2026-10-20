/**
 * The layout predicate: given a box root, resolve its shape. shapeVersion 3
 * (the one-root layout — `docs/implemented-plans/one-root-box-layout.md`) collapses the
 * old two-root package layout (package root + nested `content/` operational
 * root) into ONE root: `package.json`, `src/`, and every underscore-prefixed
 * operational area (`_content/`, `_config/`, …) all live at the same
 * directory. Identity and the recorded shape version are read in
 * `box-identity.ts`; a shape that predates 3 gets a hard error — see
 * `docs/box-layout.md`.
 *
 * This is the single layout resolver described in
 * `docs/implemented-plans/boxes-as-packages-v2.md` ("The box repository"): every other
 * consumer (schema registry, view compiler, trick runner, agent guide) reads
 * this predicate instead of re-deriving the layout itself.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { migrateBoxState } from "./state-migration.js";
import { NotABoxError } from "./box-shape-errors.js";
import { diagnoseStrayMarker, isBoxRoot, readShapeRecord, refuseV2 } from "./box-identity.js";

export { BoxShapeError } from "./box-shape-errors.js";

export interface BoxShape {
  /** The shape version recorded in the box's `package.json` `beebox` block (or its fallback marker); always 3. */
  shapeVersion: number;
  /** The box root — the ONE root; `package.json`, `src/`, and every
   * `_`-prefixed operational area all live here. */
  boxRoot: string;
}

/**
 * Determine a box's physical layout.
 *
 * A box is identified by its `package.json` declaring `beebox` plus `_config/`
 * at the same root (`isBoxRoot` in `box-identity.ts`). Its shape version comes from the `package.json`
 * `beebox` block, else from the marker. A v2 package root, a shape version
 * that predates 3 or is newer than this build, and a box with no recorded
 * version are each a `BoxShapeError`.
 *
 * @param boxRoot - The box root directory
 * @throws NotABoxError when nothing box-like is at `boxRoot`
 * @throws BoxShapeError for a box this build cannot open
 */
export async function getBoxShape(boxRoot: string): Promise<BoxShape> {
  const resolvedRoot = path.resolve(boxRoot);
  await migrateBoxState(resolvedRoot);
  await refuseV2(resolvedRoot);
  if (!(await isBoxRoot(resolvedRoot))) {
    await diagnoseStrayMarker(resolvedRoot);
    throw new NotABoxError(resolvedRoot);
  }
  const { shapeVersion } = await readShapeRecord(resolvedRoot);
  return { shapeVersion, boxRoot: resolvedRoot };
}

/** The result of a tolerant shape lookup: a resolved shape, or "no box here." */
export type BoxShapeLookup =
  | { found: true; shape: BoxShape }
  | { found: false; boxRoot: string };

/**
 * Like `getBoxShape`, but returns a discriminated result instead of throwing
 * when nothing box-like is at the path (`NotABoxError`). For the
 * arbitrary-path callers (the dev CSP tools that walk every subdir of
 * `~/src/boxes`, the audit box guard, box-schema rebuild) that must tolerate
 * "not a box". It NEVER fabricates a `BoxShape`: a v2 shape, a malformed
 * marker or block, a box with no recorded version, a broken `package.json`,
 * and any IO failure still throw.
 */
export async function getBoxShapeIfPresent(boxRoot: string): Promise<BoxShapeLookup> {
  const resolvedRoot = path.resolve(boxRoot);
  try {
    return { found: true, shape: await getBoxShape(resolvedRoot) };
  } catch (e) {
    if (e instanceof NotABoxError) return { found: false, boxRoot: resolvedRoot };
    throw e;
  }
}

/**
 * Resolve a path that should be a v3 box root. Returns the resolved root
 * when it is a box; throws the `BoxShapeError` for a box this build cannot
 * open; returns the resolved input unchanged when nothing box-like is there —
 * the tolerant contract the dev-tool callers (`csp-digest.ts`,
 * `csp-report.ts`, `audit-box.ts`, `secrets/migrate.ts`) rely on.
 */
export async function resolveBoxRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const direct = await getBoxShapeIfPresent(resolved);
  return direct.found ? direct.shape.boxRoot : resolved;
}

/**
 * Strict counterpart to `resolveBoxRoot`: throws `BoxShapeError` when the
 * resolved path is not a box, instead of passing the path through
 * unchanged. For callers (the hub, `bbx serve`) where a configured box path
 * that resolves to "not a box" must fail loudly.
 */
export async function requireBoxRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const lookup = await getBoxShapeIfPresent(resolved);
  if (lookup.found) return lookup.shape.boxRoot;
  throw new NotABoxError(resolved);
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

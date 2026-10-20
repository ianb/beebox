/**
 * Box identity and the box's recorded shape version.
 *
 * Identity is read from tracked files, so a `git clone` of a box is a box: a
 * `package.json` that declares the `beebox` dependency, plus `_config/` at the
 * same root. The shape version is the `beebox` block in that `package.json`:
 * `{ "shapeVersion": 3, "created": "<ISO>" }`. Boxes that have not yet run the
 * `box-shape-record-2026-10` migration still carry the gitignored marker
 * `.beebox/box.json`, which is read as a fallback.
 *
 * This file is the only reader of either record; `getBoxShape`
 * (`box-shape.ts`) and `findBoxRoot` (`paths/core.ts`) both go through it.
 * See `docs/box-layout.md` and `docs/implemented-plans/box-shape-in-package-json.md`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../shared/error-guards.js";
import { fileExists } from "./file-exists.js";
import { isRecord } from "../shared/is-record.js";
import { LEGACY_BOX_MARKER, LEGACY_PACKAGE_NAME } from "./state-migration.js";
import {
  BoxShapeError,
  MissingShapeRecordError,
  NewerShapeRequiredError,
  PackageJsonNotObjectError,
  PreV3ShapeError,
  UnreadablePackageJsonError,
  V2PackageRootError,
} from "./box-shape-errors.js";

/** The gitignored shape marker that predates the `package.json` block. Read only as a fallback. */
export const BOX_MARKER = ".beebox/box.json";

/** The lowest shape version this build of beebox understands. */
const MIN_KNOWN_SHAPE_VERSION = 3;

/** The highest shape version this build of beebox understands. */
const MAX_KNOWN_SHAPE_VERSION = 3;

/** The `beebox` block in a box's `package.json`. */
export const shapeBlockSchema = z.object({ shapeVersion: z.number().int(), created: z.string() });
type ShapeBlock = z.infer<typeof shapeBlockSchema>;

const markerSchema = z.object({ shapeVersion: z.number().optional(), created: z.string().optional() });
type Marker = z.infer<typeof markerSchema>;

const packageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  beebox: z.unknown().optional(),
});
type PackageJson = z.infer<typeof packageJsonSchema>;

/** A box's recorded shape: from the `package.json` block, or from the fallback marker. */
export interface ShapeRecord {
  shapeVersion: number;
  /** The box's birth date. Always present in a block; a marker may lack it. */
  created: string | undefined;
  source: "package" | "marker";
}

/** Whether `target` is a directory. A regular file named `_config` is not a structural sibling. */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return false;
    throw e;
  }
}

/**
 * Read `<dir>/package.json`, or null when there is none. A file that is there
 * but does not parse is an `UnreadablePackageJsonError`.
 */
async function readBoxPackageJson(dir: string): Promise<PackageJson | null> {
  const packageJsonPath = path.join(dir, "package.json");
  let raw: string;
  try {
    raw = await fs.readFile(packageJsonPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw new UnreadablePackageJsonError(dir, { packageJsonPath, cause: e });
  }
  try {
    return packageJsonSchema.parse(JSON.parse(raw));
  } catch (e) {
    throw new UnreadablePackageJsonError(dir, { packageJsonPath, cause: e });
  }
}

/** Whether `pkg` declares `beebox` (or the retired package name) as a dependency. */
function declaresBeeBox(pkg: PackageJson): boolean {
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  return "beebox" in deps || LEGACY_PACKAGE_NAME in deps;
}

/**
 * The identity predicate: `dir` has `_config/` (or a v2 `content/config/`)
 * and a `package.json` declaring the `beebox` dependency. The directory check
 * comes first, so walking up through ordinary directories reads no files.
 *
 * @throws UnreadablePackageJsonError when the directory check passes but `package.json` does not parse
 */
export async function isBoxRoot(dir: string): Promise<boolean> {
  const hasSibling = (await isDirectory(path.join(dir, "_config"))) || (await isDirectory(path.join(dir, "content", "config")));
  if (!hasSibling) return false;
  const pkg = await readBoxPackageJson(dir);
  return pkg !== null && declaresBeeBox(pkg);
}

/**
 * Refuse a v2 package root: no `_config/`, and either a marker at
 * `content/.beebox/box.json` or a beebox `package.json` beside `content/config/`.
 *
 * @throws V2PackageRootError for a v2 package root
 */
export async function refuseV2(dir: string): Promise<void> {
  if (await isDirectory(path.join(dir, "_config"))) return;
  if (await fileExists(path.join(dir, "content", BOX_MARKER))) throw new V2PackageRootError(dir);
  if (!(await isDirectory(path.join(dir, "content", "config")))) return;
  const pkg = await readBoxPackageJson(dir);
  if (pkg !== null && declaresBeeBox(pkg)) throw new V2PackageRootError(dir);
}

async function readMarker(markerPath: string): Promise<Marker | null> {
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  // An empty marker is the pre-JSON convention: no fields, so no shapeVersion.
  if (raw.trim() === "") return {};
  const parsed = markerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new BoxShapeError("Box marker at " + markerPath + " is malformed (see cause).", { cause: parsed.error });
  }
  return parsed.data;
}

function checkRange(dir: string, shapeVersion: number | undefined): number {
  if (shapeVersion === undefined || shapeVersion < MIN_KNOWN_SHAPE_VERSION) {
    throw new PreV3ShapeError(dir, shapeVersion);
  }
  if (shapeVersion > MAX_KNOWN_SHAPE_VERSION) {
    throw new NewerShapeRequiredError(dir, { shapeVersion, maxKnownShapeVersion: MAX_KNOWN_SHAPE_VERSION });
  }
  return shapeVersion;
}

/**
 * Read the shape record at `dir`: the `package.json` `beebox` block, else the
 * `.beebox/box.json` marker. Writes nothing.
 *
 * @throws MissingShapeRecordError when neither exists
 * @throws BoxShapeError when the block or marker is malformed, predates v3, or is newer than this build
 */
export async function readShapeRecord(dir: string): Promise<ShapeRecord> {
  const pkg = await readBoxPackageJson(dir);
  if (pkg?.beebox !== undefined) {
    const block = shapeBlockSchema.safeParse(pkg.beebox);
    if (!block.success) {
      throw new BoxShapeError(
        "The \"beebox\" block in " + path.join(dir, "package.json") + " is malformed (see cause). " +
          "Expected { \"shapeVersion\": 3, \"created\": \"<ISO date>\" }.",
        { cause: block.error }
      );
    }
    return { shapeVersion: checkRange(dir, block.data.shapeVersion), created: block.data.created, source: "package" };
  }
  const marker = await readMarker(path.join(dir, BOX_MARKER));
  if (marker === null) throw new MissingShapeRecordError(dir);
  return { shapeVersion: checkRange(dir, marker.shapeVersion), created: marker.created, source: "marker" };
}

/**
 * A `.beebox/box.json` at a directory that fails `isBoxRoot` does not make it a
 * box: identity is the dependency plus the sibling. It is still evidence of
 * an old or broken box, so a marker that is malformed, predates v3, or is
 * newer than this build throws its diagnosis (a v1 box had no package.json; a
 * v2 `content/` root had no `_config/`). A valid v3 marker there is ignored.
 *
 * @throws BoxShapeError for a marker that is malformed or not shape 3
 */
export async function diagnoseStrayMarker(dir: string): Promise<void> {
  const marker = await readMarker(path.join(dir, BOX_MARKER));
  if (marker !== null) checkRange(dir, marker.shapeVersion);
}

/**
 * One level of upward box discovery (`findBoxRoot`). Returns true when `dir`
 * is a box root, false when there is nothing box-like here.
 *
 * A retired-name marker alone counts, so `requireBoxRoot` can still reach the
 * state migration that moves it; its shape version is checked as before.
 *
 * @throws BoxShapeError when `dir` is box-like but its shape is not one this build can open
 */
export async function probeBoxLevel(dir: string): Promise<boolean> {
  const hasMarker = await fileExists(path.join(dir, BOX_MARKER));
  if (!hasMarker && (await fileExists(path.join(dir, LEGACY_BOX_MARKER)))) {
    const legacy = await readMarker(path.join(dir, LEGACY_BOX_MARKER));
    checkRange(dir, legacy?.shapeVersion);
    return true;
  }
  await refuseV2(dir);
  if (!(await isBoxRoot(dir))) {
    await diagnoseStrayMarker(dir);
    return false;
  }
  await readShapeRecord(dir);
  return true;
}

/**
 * Where `dir` records its shape, without validating it: the `package.json`
 * block, the fallback marker, or nowhere (null). For `initBox`'s
 * fresh-or-update decision; `readShapeRecord` is the validating read.
 */
export async function recordedShapeSource(dir: string): Promise<ShapeRecord["source"] | null> {
  const pkg = await readBoxPackageJson(dir);
  if (pkg?.beebox !== undefined) return "package";
  return (await fileExists(path.join(dir, BOX_MARKER))) ? "marker" : null;
}

/**
 * `packageJsonText` with its `beebox` block set to `block`, or removed when
 * `block` is null. Other keys keep their order; the block goes last. Pure, so
 * `initBox` and the `box-shape-record-2026-10` migration write it one way.
 *
 * @throws PackageJsonNotObjectError when the text is not a JSON object
 */
export function setShapeBlock(packageJsonText: string, block: ShapeBlock | null): string {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!isRecord(parsed)) throw new PackageJsonNotObjectError();
  const { beebox: _previous, ...rest } = parsed;
  return JSON.stringify(block === null ? rest : { ...rest, beebox: block }, null, 2) + "\n";
}

/** Write `block` into `<dir>/package.json` (null removes it). */
export async function writeShapeBlock(dir: string, block: ShapeBlock | null): Promise<void> {
  const packageJsonPath = path.join(dir, "package.json");
  let raw: string;
  try {
    raw = await fs.readFile(packageJsonPath, "utf-8");
  } catch (e) {
    throw new UnreadablePackageJsonError(dir, { packageJsonPath, cause: e });
  }
  await fs.writeFile(packageJsonPath, setShapeBlock(raw, block));
}

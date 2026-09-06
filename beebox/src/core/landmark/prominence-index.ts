/**
 * The prominence index: "which cards under this directory carry a level,
 * and what does each subdirectory's derived list boil down to" —
 * `docs/implemented-plans/card-prominence.md`, Track B.
 *
 * The unit of work is a landmark's **pruned subtree**: its directory and
 * every descendant directory, stopping at any directory that has its own
 * landmark card (that directory contributes one `nested` entry instead of
 * being walked into) and never entering an OWNED `<basename>.attach/` scope
 * (its owner card is a sibling; Browse already folds it, and derivation
 * follows the same fold) — except an attach scope that itself holds a
 * landmark card, which is a nested landmark like any other.
 *
 * Discovery (which files/directories exist) is fresh on every call, a plain
 * `readdir` walk; only the PARSE of one file's bytes is memoized
 * (`prominence-cache.ts`, the `card-cache.ts` pattern). No file-watcher
 * dependence: correct for `bbx validate` and for a `git pull` a watcher
 * never saw.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { typeFromFilename, type LoadCardContext } from "../card-io.js";
import { errnoCode } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { effectiveLevel, type ProminenceLevel } from "../../shared/prominence.js";
import { attachDirOwnerBasename, cardBasename, isAttachDirName } from "../../shared/attach-path.js";
import { landmarkScanDir, normalizeLandmarkDir } from "./root-dir.js";
import { readLandmarkSymbol } from "./symbol.js";
import { readFrontmatterCached, readLandmarkFieldsCached } from "./prominence-cache.js";
import type { LandmarkSummary } from "./summaries.js";

/** One indexed card or nested landmark under a landmark's pruned subtree. Ordinary cards are never indexed. */
export interface ProminenceEntry {
  /** Box-relative path, leading "/". */
  boxPath: string;
  level: ProminenceLevel;
  /** A "landmark" entry describes the directory it stops at, not a visitable file. */
  kind: "card" | "landmark";
}

export interface DirectorySummary {
  /** Whether the pruned subtree contains an entry-point card anywhere. */
  hasEntryPoint: boolean;
  /** Count of primary cards anywhere in the pruned subtree. */
  primaryCount: number;
  /** This directory's own landmark says `background`, or an ancestor's does. */
  background: boolean;
}

export interface PrunedSubtree {
  entries: ProminenceEntry[];
  /** Stopped directories' landmarks — background ones excluded. */
  nested: LandmarkSummary[];
  summary: DirectorySummary;
  /**
   * Box paths (leading "/") of every ordinary card the walk reached,
   * regardless of level — including `ordinary` ones `entries` omits. Used
   * by the `landmark-links-prominence` migration to test subtree
   * membership for a target that has no level yet, so it doesn't
   * reimplement the walk's stop rules (nested landmark, owned attach scope).
   */
  cardBoxPaths: ReadonlySet<string>;
}

// Directories a pruned walk never descends into, even when they hold cards —
// dependency/VCS/tooling areas that can't hold authored content. Mirrors
// `list-cards.ts`'s CARD_GLOB_IGNORE; defensive rather than load-bearing,
// since the walk starts inside a box's content area.
const WALK_SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".beebox", "_tmp"]);

/**
 * Compute the pruned subtree for the landmark living in `dir` (box-relative,
 * "" for the root). `dir`'s own landmark card — the one this derivation is
 * FOR — is never itself an entry; a `background` landmark at `dir` or any
 * ancestor of `dir` short-circuits to an empty, `background: true` result.
 */
export async function prunedSubtree(boxRoot: string, dir: string): Promise<PrunedSubtree> {
  return prunedSubtreeWith({ boxRoot, cardSchemas: await createCardSchemaMap(boxRoot) }, dir);
}

/** A box root plus its schema map, so a caller walking many directories builds the map once. */
export interface ProminenceWalkContext {
  boxRoot: string;
  cardSchemas: LoadCardContext["cardSchemas"];
}

/** {@link prunedSubtree} with a caller-supplied schema map (Browse lists many subdirectories per request). */
export async function prunedSubtreeWith(
  { boxRoot, cardSchemas }: ProminenceWalkContext,
  dir: string,
): Promise<PrunedSubtree> {
  if (await isUnderBackgroundAncestor(boxRoot, dir)) {
    return {
      entries: [],
      nested: [],
      summary: { hasEntryPoint: false, primaryCount: 0, background: true },
      cardBoxPaths: new Set(),
    };
  }

  const state: WalkState = {
    boxRoot,
    ctx: { cardSchemas },
    entries: [],
    nested: [],
    cardBoxPaths: new Set(),
  };
  await walk(state, { physicalDir: landmarkScanDir(boxRoot, dir), isTop: true });

  const hasEntryPoint = state.entries.some((e) => e.kind === "card" && e.level === "entry-point");
  const primaryCount = state.entries.filter((e) => e.kind === "card" && e.level === "primary").length;
  return {
    entries: state.entries,
    nested: state.nested,
    summary: { hasEntryPoint, primaryCount, background: false },
    cardBoxPaths: state.cardBoxPaths,
  };
}

/**
 * Logical parent of a box-relative landmark dir ("" has none). Exported for
 * `cascade.ts`'s `isListedLandmark`, which walks the same ancestor chain to
 * decide whether a landmark is under a `background` ancestor.
 */
export function parentLandmarkDir(dir: string): string | null {
  if (dir === "") return null;
  const i = dir.lastIndexOf("/");
  return i === -1 ? "" : dir.slice(0, i);
}

/** Whether `dir`'s own landmark, or any ancestor's, is written `prominence: background`. */
async function isUnderBackgroundAncestor(boxRoot: string, dir: string): Promise<boolean> {
  for (let cursor: string | null = dir; cursor !== null; cursor = parentLandmarkDir(cursor)) {
    if (await landmarkAtDirIsBackground(boxRoot, cursor)) return true;
  }
  return false;
}

async function landmarkAtDirIsBackground(boxRoot: string, dir: string): Promise<boolean> {
  // The root landmark is the box's identity, not a place that can be
  // housekeeping: a written `background` there is ignored (and lint-warned),
  // never cascaded over the whole box.
  if (dir === "") return false;
  const physical = landmarkScanDir(boxRoot, dir);
  const cardName = await findLandmarkCardName(physical);
  if (cardName === null) return false;
  const fields = await readLandmarkFieldsCached(path.join(physical, cardName));
  return fields?.prominence === "background";
}

/**
 * The (sorted-first, by convention) `*.landmark.card` filename directly in
 * `physicalDir`, or null. Exported for `status.browse` (Track C), which
 * needs a subdirectory's own landmark identity (label/symbol) the same way
 * this module finds a nested landmark's.
 */
export async function findLandmarkCardName(physicalDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(physicalDir);
  } catch (_e) {
    return null;
  }
  const matches = names.filter((n) => n.endsWith(".landmark.card")).toSorted();
  return matches[0] ?? null;
}

interface WalkItem {
  physicalDir: string;
  isTop: boolean;
}

interface WalkState {
  boxRoot: string;
  ctx: LoadCardContext;
  entries: ProminenceEntry[];
  nested: LandmarkSummary[];
  cardBoxPaths: Set<string>;
}

async function walk(state: WalkState, start: WalkItem): Promise<void> {
  const queue: WalkItem[] = [start];
  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    await visitDir(state, { item, queue });
  }
}

async function visitDir(state: WalkState, { item, queue }: { item: WalkItem; queue: WalkItem[] }): Promise<void> {
  const { physicalDir, isTop } = item;
  let dirents;
  try {
    dirents = await fs.readdir(physicalDir, { withFileTypes: true });
  } catch (_e) {
    return;
  }

  if (!isTop) {
    const landmarkName = dirents.filter((d) => d.isFile() && d.name.endsWith(".landmark.card")).map((d) => d.name).toSorted()[0];
    if (landmarkName !== undefined) {
      await addNestedLandmark(state, path.join(physicalDir, landmarkName));
      return;
    }
  }

  const cardBasenames = new Set(
    dirents.filter((d) => d.isFile() && d.name.endsWith(".card")).map((d) => cardBasename(d.name).toLowerCase()),
  );

  for (const dirent of dirents) {
    if (dirent.isFile()) {
      if (dirent.name.endsWith(".landmark.card")) continue; // the top landmark itself, or already handled above
      if (!dirent.name.endsWith(".card")) continue;
      await addCardEntry(state, path.join(physicalDir, dirent.name));
      continue;
    }
    if (!dirent.isDirectory()) continue;
    if (WALK_SKIP_DIRS.has(dirent.name) || dirent.name.startsWith(".")) continue;

    const childPhysical = path.join(physicalDir, dirent.name);
    if (isAttachDirName(dirent.name)) {
      const owner = attachDirOwnerBasename(dirent.name);
      const owned = owner !== null && cardBasenames.has(owner.toLowerCase());
      if (!owned) continue; // an unowned attach-like dir walks as an ordinary directory would be surprising; skip like Browse's fold has nothing to fold it into either
      const landmarkName = await findLandmarkCardName(childPhysical);
      if (landmarkName === null) continue; // owned attach scope, not its own landmark: never walked
      await addNestedLandmark(state, path.join(childPhysical, landmarkName));
      continue;
    }
    queue.push({ physicalDir: childPhysical, isTop: false });
  }
}

async function addCardEntry(state: WalkState, absPath: string): Promise<void> {
  const type = typeFromFilename(absPath);
  if (type === undefined) return;
  const schema = state.ctx.cardSchemas.get(type);
  if (schema === undefined) return;
  const boxPath = boxPathOf(state.boxRoot, absPath);
  const frontmatter = await unlessVanished(() => readFrontmatterCached(absPath));
  if (frontmatter === undefined) return; // gone between readdir and read: not there, not an error
  state.cardBoxPaths.add(boxPath);
  const declaredRaw = frontmatter?.["prominence"];
  const declared = isProminenceLevel(declaredRaw) ? declaredRaw : undefined;
  const level = effectiveLevel({ declared, typeDefault: schema.defaultProminence });
  if (level === "ordinary") return;
  state.entries.push({ boxPath, level, kind: "card" });
}

/**
 * Run a read that raced a concurrent delete or atomic move: `ENOENT` after
 * `readdir` listed the file means "not there", answered as `undefined`, so one
 * vanished card never fails the whole landmark or Browse resolution. Every
 * other error is real and propagates.
 */
async function unlessVanished<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return undefined;
    throw e;
  }
}

async function addNestedLandmark(state: WalkState, absPath: string): Promise<void> {
  const fields = await unlessVanished(() => readLandmarkFieldsCached(absPath));
  if (fields === null || fields === undefined) return;
  if (fields.prominence === "background") return; // a written background landmark contributes nothing (Track A cascade)

  const relPath = path.relative(state.boxRoot, absPath).split(path.sep).join("/");
  const symbol = readLandmarkSymbol(fields, { landmarkPath: relPath });
  const label = (fields.navigation?.label ?? "") || path.basename(absPath, ".landmark.card");
  const landmarkSchema = state.ctx.cardSchemas.get("landmark");
  const typeDefault = landmarkSchema?.defaultProminence ?? "background";
  const resolved = effectiveLevel({ declared: fields.prominence, typeDefault });
  // A landmark's type default is always "background" (LandmarkSchema declares
  // it); "ordinary" is unreachable here but the shared EffectiveLevel type
  // can't say so statically.
  const level = resolved === "ordinary" ? "background" : resolved;

  state.nested.push({
    path: relPath,
    dir: normalizeLandmarkDir(path.dirname(relPath)),
    label,
    symbol,
    prominence: fields.prominence ?? null,
  });
  state.entries.push({ boxPath: `/${relPath}`, level, kind: "landmark" });
}

function boxPathOf(boxRoot: string, absPath: string): string {
  return `/${path.relative(boxRoot, absPath).split(path.sep).join("/")}`;
}

function isProminenceLevel(value: unknown): value is ProminenceLevel {
  return value === "entry-point" || value === "primary" || value === "background";
}

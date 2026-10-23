// Store access for the exhibits surface: root derivation, the marker guard,
// path containment, and manifest reads.
//
// The store is disk written by several agents and a human, so it is an
// untrusted boundary (engineering principle 3): every segment is schema
// validated, every resolved path is re-checked after realpath, and a manifest
// is Zod-parsed before anything renders. Containment lives here and only here;
// route handlers trust what this module returns (principle 6).
//
// This deliberately reimplements the shape of src/server/main/issue-path.ts rather
// than importing it: the two roots have different vocabularies, and the
// resident-app precedent is to share patterns, not source.

import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  MANIFEST_FILE,
  exhibitManifestSchema,
  exhibitSegmentSchema,
  type ExhibitManifest,
} from "../../shared/exhibits.js";
import { isWithin } from "../../../../beebox/src/lib/box-containment.js";

/** Written by bin/lib/exhibits-store.sh when the store root is created. */
export const STORE_MARKER = ".workstream-exhibits";

/** Where an exhibit's documents live, relative to its directory. */
export const DATA_DIR = "data";

/** Reserved: /apps/<name> is the committed-app tier, not a workstream. */
export const APPS_SEGMENT = "apps";

/**
 * Reserved: `<store>/<workstream>/coding-feedback/` holds CODING_FEEDBACK
 * entries (bin/coding-feedback), retrospective notes that are not exhibits.
 * Never listed, never routed.
 */
export const CODING_FEEDBACK_SEGMENT = "coding-feedback";

export class InvalidExhibitPathError extends Error {
  constructor(relPath: string) {
    super(`invalid exhibit path: ${relPath}`);
    this.name = "InvalidExhibitPathError";
  }
}

export class UninitializedStoreError extends Error {
  constructor(public readonly storeRoot: string) {
    super(`exhibit store ${storeRoot} is missing its ${STORE_MARKER} marker`);
    this.name = "UninitializedStoreError";
  }
}

/**
 * The store sits beside the main checkout, matching wt_paths_init's
 * WT_EXHIBITS_ROOT (bin/lib/worktree-paths.sh). Derived from the MAIN
 * checkout — a run from anywhere else passes BBX_EXHIBITS_ROOT.
 */
export function defaultStoreRoot(repoRoot: string): string {
  return path.join(path.dirname(path.resolve(repoRoot)), "workstream-exhibits");
}

function assertContained(options: { root: string; target: string; relPath: string }): void {
  if (path.relative(options.root, options.target) === "" || !isWithin(options.root, options.target)) {
    throw new InvalidExhibitPathError(options.relPath);
  }
}

/**
 * Resolve `segments` under `root`, refusing traversal, absolute escapes, and
 * symlinks that leave the root. Returns the canonical (realpath'd) target.
 */
export async function resolveUnderRoot(root: string, segments: string[]): Promise<string> {
  const relPath = segments.join("/");
  if (segments.length === 0) throw new InvalidExhibitPathError(relPath);
  for (const segment of segments) {
    if (!exhibitSegmentSchema.safeParse(segment).success || segment === CODING_FEEDBACK_SEGMENT) throw new InvalidExhibitPathError(relPath);
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  assertContained({ root: resolvedRoot, target, relPath });

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    [canonicalRoot, canonicalTarget] = await Promise.all([
      fs.realpath(resolvedRoot),
      fs.realpath(target),
    ]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new InvalidExhibitPathError(relPath);
    }
    throw error;
  }
  assertContained({ root: canonicalRoot, target: canonicalTarget, relPath });
  return canonicalTarget;
}

/** Fail closed when the root is not an initialized store (marker discipline). */
export async function assertStoreInitialized(storeRoot: string): Promise<void> {
  try {
    const marker = await fs.stat(path.join(storeRoot, STORE_MARKER));
    if (!marker.isFile()) throw new UninitializedStoreError(storeRoot);
  } catch (error) {
    if (error instanceof UninitializedStoreError) throw error;
    throw new UninitializedStoreError(storeRoot);
  }
}

export type ExhibitTier = "module" | "html" | "default";

export interface ResolvedExhibit {
  dir: string;
  tier: ExhibitTier;
}

/** Directory listing decides the page tier; index.tsx wins over index.html. */
export async function resolveExhibitDir(root: string, segments: string[]): Promise<ResolvedExhibit | null> {
  let dir: string;
  try {
    dir = await resolveUnderRoot(root, segments);
  } catch (error) {
    if (error instanceof InvalidExhibitPathError) return null;
    throw error;
  }
  const stats = await fs.stat(dir);
  if (!stats.isDirectory()) return null;
  const entries = await fs.readdir(dir);
  if (entries.includes("index.tsx")) return { dir, tier: "module" };
  if (entries.includes("index.html")) return { dir, tier: "html" };
  return { dir, tier: "default" };
}

export type ManifestResult =
  | { ok: true; manifest: ExhibitManifest }
  | { ok: false; missing: boolean; issues: string[] };

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  const where = issue.path.map((part) => String(part)).join(".");
  return where === "" ? issue.message : `${where}: ${issue.message}`;
}

/**
 * Manifests written before the ask was removed carry `ask: { prose, ... }`.
 * Lift `ask.prose` into a missing top-level `prose`, then drop `ask`; its other
 * contents are never validated. Read side only: nothing writes `ask` any more.
 */
export function liftLegacyManifest(raw: unknown): unknown {
  const object = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!object.success || !("ask" in object.data)) return raw;
  const { ask, ...rest } = object.data;
  if (typeof rest.prose === "string" && rest.prose !== "") return rest;
  const prose = z.object({ prose: z.string() }).safeParse(ask);
  if (prose.success) return { ...rest, prose: prose.data.prose };
  // No usable ask.prose: an empty top-level prose stays and fails validation as before.
  return rest;
}

/**
 * Read and validate exhibit.json. A directory with content but no usable
 * manifest is an error the developer must see, never a bare listing
 * (principle 4).
 */
export async function readManifest(dir: string): Promise<ManifestResult> {
  const file = path.join(dir, MANIFEST_FILE);
  // The same posture the events log takes (api.ts): a manifest that is a
  // symlink is refused rather than followed, so nothing outside the store can
  // be read through an exhibit directory.
  if (await fs.lstat(file).then((stats) => stats.isSymbolicLink(), () => false)) {
    return { ok: false, missing: false, issues: [`${MANIFEST_FILE} is a symlink; it is refused rather than followed`] };
  }
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: false, missing: true, issues: [`${MANIFEST_FILE} is missing`] };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      missing: false,
      issues: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const result = exhibitManifestSchema.safeParse(liftLegacyManifest(parsed));
  if (!result.success) {
    return { ok: false, missing: false, issues: result.error.issues.map(formatIssue) };
  }
  return { ok: true, manifest: result.data };
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Directory entries that can be routed to: named like a segment, a real
 * directory.
 *
 * `lstat`, never `stat`: a scan enumerates names that callers then join to the
 * root and read from, and a symlinked entry would make those reads follow the
 * link wherever it points. The direct routes refuse such an entry already
 * (resolveUnderRoot realpaths), so following it here would also make listings
 * advertise pages that 404 — one rule, both paths.
 */
export async function listRoutableDirs(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const name of (await readdirSafe(root)).toSorted()) {
    if (!exhibitSegmentSchema.safeParse(name).success || name === CODING_FEEDBACK_SEGMENT) continue;
    const stats = await fs.lstat(path.join(root, name)).catch(() => null);
    if (stats?.isDirectory()) names.push(name);
  }
  return names;
}

/** Workstreams with a store directory. `apps` is the committed-app tier. */
export async function listWorkstreams(storeRoot: string): Promise<string[]> {
  return (await listRoutableDirs(storeRoot)).filter((name) => name !== APPS_SEGMENT);
}

export interface ExhibitListing {
  name: string;
  title: string | null;
  error: string | null;
}

export async function listExhibits(root: string): Promise<ExhibitListing[]> {
  const listings: ExhibitListing[] = [];
  for (const name of await listRoutableDirs(root)) {
    const manifest = await readManifest(path.join(root, name));
    listings.push(
      manifest.ok
        ? { name, title: manifest.manifest.title, error: null }
        : { name, title: null, error: manifest.issues.join("; ") },
    );
  }
  return listings;
}

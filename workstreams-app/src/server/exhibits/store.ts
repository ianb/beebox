// Store access for the exhibits surface: root derivation, the marker guard,
// path containment, and manifest reads.
//
// The store is disk written by several agents and a human, so it is an
// untrusted boundary (engineering principle 3): every segment is schema
// validated, every resolved path is re-checked after realpath, and a manifest
// is Zod-parsed before anything renders. Containment lives here and only here;
// route handlers trust what this module returns (principle 6).
//
// This deliberately reimplements the shape of src/server/issue-path.ts rather
// than importing it: the two roots have different vocabularies, and the
// resident-app precedent is to share patterns, not source.

import fs from "node:fs/promises";
import path from "node:path";

import {
  MANIFEST_FILE,
  appManifestSchema,
  exhibitManifestSchema,
  exhibitSegmentSchema,
  type ExhibitManifest,
} from "../../shared/exhibits.js";
import { readDisposition } from "./disposition.js";

/** Written by bin/lib/exhibits-store.sh when the store root is created. */
export const STORE_MARKER = ".workstream-exhibits";

/** Reserved: /apps/<name> is the committed-app tier, not a workstream. */
export const APPS_SEGMENT = "apps";

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
 * checkout — a run from anywhere else passes CALLBACK_EXHIBITS_ROOT.
 */
export function defaultStoreRoot(repoRoot: string): string {
  return path.join(path.dirname(path.resolve(repoRoot)), "workstream-exhibits");
}

function assertContained(options: { root: string; target: string; relPath: string }): void {
  const relative = path.relative(options.root, options.target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
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
    if (!exhibitSegmentSchema.safeParse(segment).success) throw new InvalidExhibitPathError(relPath);
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
 * Read and validate exhibit.json. A directory with content but no usable
 * manifest is an error the developer must see, never a bare listing
 * (principle 4) — the ask is what makes an exhibit an exhibit.
 */
export async function readManifest(dir: string, options: { requireAsk: boolean }): Promise<ManifestResult> {
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
  const schema = options.requireAsk ? exhibitManifestSchema : appManifestSchema;
  const result = schema.safeParse(parsed);
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
    if (!exhibitSegmentSchema.safeParse(name).success) continue;
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
  askType: string | null;
  /** Null when the exhibit states no ask; otherwise whether it was answered. */
  answered: boolean | null;
  /** A disposition that exists but cannot be read as one. */
  problem: string | null;
  error: string | null;
}

export interface ListExhibitsOptions {
  requireAsk: boolean;
  /**
   * Where each exhibit's runtime data lives, when that is not the same tree as
   * its manifest — a committed app's code is tracked in the checkout while its
   * documents stay in the store.
   */
  dataRoot?: string;
}

/**
 * The listing a developer scans to find what still needs them, so it carries
 * answered state — read through the same helper the ask queue uses, because two
 * definitions of "answered" would drift the moment one of them was wrong.
 */
export async function listExhibits(root: string, options: ListExhibitsOptions): Promise<ExhibitListing[]> {
  const listings: ExhibitListing[] = [];
  for (const name of await listRoutableDirs(root)) {
    const manifest = await readManifest(path.join(root, name), { requireAsk: options.requireAsk });
    if (!manifest.ok) {
      listings.push({ name, title: null, askType: null, answered: null, problem: null, error: manifest.issues.join("; ") });
      continue;
    }
    const ask = manifest.manifest.ask ?? null;
    const disposition = ask === null ? null : await readDisposition(path.join(options.dataRoot ?? root, name));
    listings.push({
      name,
      title: manifest.manifest.title,
      askType: ask?.type ?? null,
      answered: disposition?.answered ?? null,
      problem: disposition?.problem ?? null,
      error: null,
    });
  }
  return listings;
}

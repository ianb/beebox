// Resolve a router "box entry" (an item from BOXES=, MAIN_BOX_DEFAULTS, or a
// worktree's default box path) into the box's content dir and URL slug.
//
// An entry can point at any of three things (see "The box repository" and
// Track G in docs/implemented-plans/boxes-as-packages-v2.md):
//   - a legacy (shapeVersion 1) box dir — content and package root are the
//     same directory.
//   - a v2 box's PACKAGE root (has `content/.cb-box` inside it).
//   - a v2 box's `content/` dir directly (has `.cb-box` right there).
//
// This is deliberately independent of callback-box's own `src/cli/lib/
// box-shape.ts` (the engine's canonical predicate) rather than importing it:
// the router serves many worktrees side by side, each pinning its own
// checkout — sometimes an older one that predates this predicate entirely —
// and the router's own tsconfig excludes callback-box for exactly this
// reason (see tsconfig.json at the repo root). Router-side detection only
// needs to know "where's the content dir, what's the slug" — a much smaller
// and more version-stable question than the engine's fail-closed shape
// validation, so a small duplicate here is the right tradeoff over a
// cross-version import.
//
// Dev keeps the one-process-many-boxes model: a single `server-main.ts`
// (one engine version, this worktree's own checkout) serves every box this
// worktree lists, in one Fastify process — same as today for legacy boxes.
// The plan's end-state ("Serving") spawns a box's OWN `node_modules/.bin/cb
// serve` per box for real per-box engine-version isolation, but that only
// matters once boxes can pin *different* engine versions from each other;
// in dev every box a worktree serves shares that worktree's one checked-out
// engine anyway, so per-box processes would buy nothing here (the plan's
// stated legacy/dev escape hatch — see Track G / "Serving").

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ResolvedBoxEntry {
  /** The box's operational root — what gets passed to server-main.ts. */
  contentDir: string;
  /** The URL slug this box is served under: `/<worktree>/<slug>/...`. */
  slug: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve one BOXES entry to `{ contentDir, slug }`.
 *
 * - `<entry>/.cb-box` exists → `entry` IS a box root already.
 *   - A v2 marker there means `entry` is a v2 `content/` dir passed
 *     directly: slug comes from the PACKAGE root (entry's parent), since
 *     `content/`'s own basename is always the literal string "content".
 *   - Otherwise (legacy, or the marker doesn't parse as v2): slug is
 *     `entry`'s own basename, same as always.
 * - Else `<entry>/content/.cb-box` exists → `entry` is a v2 PACKAGE root:
 *   contentDir is `entry/content`, slug is `entry`'s own basename.
 * - Else (no marker found anywhere, e.g. a nonexistent path or a fixture
 *   dir in a test) → tolerate it the same way the engine's
 *   `getBoxShapeOrLegacyFallback` does: treat `entry` as a legacy box root.
 */
export async function resolveBoxEntry(entry: string): Promise<ResolvedBoxEntry> {
  const resolved = path.resolve(entry);

  if (await exists(path.join(resolved, ".cb-box"))) {
    const shapeVersion = await readShapeVersion(resolved);
    if (shapeVersion >= 2) {
      return { contentDir: resolved, slug: path.basename(path.dirname(resolved)) };
    }
    return { contentDir: resolved, slug: path.basename(resolved) };
  }

  const nestedContent = path.join(resolved, "content");
  if (await exists(path.join(nestedContent, ".cb-box"))) {
    return { contentDir: nestedContent, slug: path.basename(resolved) };
  }

  // Legacy fallback: no marker anywhere (nonexistent path, test fixture).
  return { contentDir: resolved, slug: path.basename(resolved) };
}

async function readShapeVersion(boxRoot: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, ".cb-box"), "utf-8");
    if (raw.trim() === "") return 1;
    const marker = JSON.parse(raw) as { shapeVersion?: number };
    return marker.shapeVersion ?? 1;
  } catch {
    return 1;
  }
}

/** `resolveBoxEntry` over a whole BOXES list, in order. */
export async function resolveBoxEntries(entries: string[]): Promise<ResolvedBoxEntry[]> {
  return Promise.all(entries.map(resolveBoxEntry));
}

/** `server-main.ts` argv format: `<slug>=<contentDir>`, one per box. */
export function boxEntryToArg({ contentDir, slug }: ResolvedBoxEntry): string {
  return `${slug}=${contentDir}`;
}

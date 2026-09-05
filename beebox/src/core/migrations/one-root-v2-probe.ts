/**
 * The v2-tolerant shape probe — Track E's "Bootstrap" paragraph
 * (`docs/implemented-plans/one-root-box-layout.md`). `getBoxShape` (`src/lib/box-shape.ts`)
 * refuses every v2 box on purpose (the v3-only engine's whole point), but
 * `bbx migrate` still has to REACH a v2 box to convert it. This module is the
 * one place allowed to read a v2 marker without throwing — used ONLY by the
 * migration bootstrap path in `src/cli/commands/migrate.ts`, never by normal
 * box resolution.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";

const v2MarkerSchema = z.object({ shapeVersion: z.number().optional() });

export interface V2Box {
  /** The v2 PACKAGE root (contains `package.json`, `src/`, `content/`). */
  packageRoot: string;
  /** The v2 operational root (`<packageRoot>/content`). */
  contentRoot: string;
  /** The marker's declared shapeVersion (0/undefined both mean "predates the field"). */
  shapeVersion: number;
}

/**
 * Probe `inputPath` for a v2 box, tolerating everything `getBoxShape` would
 * throw on. Recognizes two shapes:
 *  - `inputPath` IS the v2 package root: no marker of its own, but one at
 *    `<inputPath>/content/.beebox/box.json`.
 *  - `inputPath` IS the v2 content root itself (marker directly at
 *    `<inputPath>/.beebox/box.json`, `shapeVersion` absent or `< 3`): the
 *    package root is then `inputPath`'s parent.
 *
 * Returns `null` for anything else (not a box at all, or already v3 — the
 * caller should fall through to normal `getBoxShape` resolution for those).
 * Never throws on ENOENT/malformed-marker; a genuinely unreadable
 * `package.json` at the resolved package root still throws (a real problem,
 * not "not a v2 box").
 */
export async function probeV2Box(inputPath: string): Promise<V2Box | null> {
  const resolved = path.resolve(inputPath);

  const asPackageRoot = await tryContentRoot(path.join(resolved, "content"), resolved);
  if (asPackageRoot !== null) return asPackageRoot;

  // inputPath might already BE the v2 content root (e.g. a manifest entry
  // that predates this plan and still points at `.../content`).
  if (path.basename(resolved) === "content") {
    const asContentRoot = await tryContentRoot(resolved, path.dirname(resolved));
    if (asContentRoot !== null) return asContentRoot;
  }

  return null;
}

async function tryContentRoot(contentRoot: string, packageRoot: string): Promise<V2Box | null> {
  const markerPath = path.join(contentRoot, ".beebox", "box.json");
  let raw: string;
  try {
    raw = await fs.readFile(markerPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  if (raw.trim() === "") return { packageRoot, contentRoot, shapeVersion: 0 };
  const parsed = v2MarkerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  const shapeVersion = parsed.data.shapeVersion ?? 0;
  if (shapeVersion >= 3) return null; // already v3 at this nested path — not our case
  return { packageRoot, contentRoot, shapeVersion };
}

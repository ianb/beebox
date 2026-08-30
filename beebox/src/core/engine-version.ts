/**
 * Engine-version surfacing (Track E, chunk E2 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`): a v2 box pins its own `beebox`
 * dependency, which can drift from whichever engine is actually SERVING it
 * (the hub serving a v2 box with a different engine version is
 * future-normal per the plan's "Distribution" section — for now a mismatch
 * is just flagged, not acted on). `bbx status` and `/healthz` both read these
 * two helpers so the two surfaces report the same thing the same way.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { getBoxShape } from "../lib/box-shape.js";
import { z } from "zod";

const packageJsonVersionSchema = z.object({ version: z.string().optional() });

async function readVersionField(packageJsonPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = packageJsonVersionSchema.parse(JSON.parse(raw));
    return pkg.version ?? null;
  } catch (_e) {
    // Missing/unreadable/malformed package.json — nothing actionable to
    // report beyond "unknown"; callers treat null as "can't tell."
    return null;
  }
}

/** The version of the engine process that's actually running right now
 *  (this build's own `package.json`) — regardless of which box it's serving. */
export async function getServingEngineVersion(): Promise<string | null> {
  return readVersionField(path.join(PACKAGE_ROOT, "package.json"));
}

/**
 * The version of `beebox` a box has installed in its OWN
 * `node_modules/` (what `bbx upgrade` bumps and what a real `pnpm install`
 * resolves). `null` if the box's `node_modules/beebox/package.json`
 * can't be read (not installed yet, or the dev-convenience symlink from
 * `scaffoldPackageRoot` points somewhere unreadable).
 */
export async function getInstalledEngineVersion(boxRoot: string): Promise<string | null> {
  const shape = await getBoxShape(boxRoot);
  return readVersionField(path.join(shape.packageRoot, "node_modules/beebox/package.json"));
}

export interface EngineVersionReport {
  /** The version of the engine process currently serving this box. */
  serving: string | null;
  /** The version this box has pinned/installed (null if not readable). */
  installed: string | null;
  /** True only when both are known and differ. */
  mismatch: boolean;
}

/** Combine the two version reads into the shape `bbx status` and `/healthz`
 *  both print, deciding `mismatch` in one place so the two surfaces can't
 *  disagree on the comparison itself. */
export async function getEngineVersionReport(boxRoot: string): Promise<EngineVersionReport> {
  const [serving, installed] = await Promise.all([
    getServingEngineVersion(),
    getInstalledEngineVersion(boxRoot),
  ]);
  const mismatch = serving !== null && installed !== null && serving !== installed;
  return { serving, installed, mismatch };
}

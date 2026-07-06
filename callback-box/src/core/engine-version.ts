/**
 * Engine-version surfacing (Track E, chunk E2 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`): a v2 box pins its own `callback-box`
 * dependency, which can drift from whichever engine is actually SERVING it
 * (the hub serving a v2 box with a different engine version is
 * future-normal per the plan's "Distribution" section — for now a mismatch
 * is just flagged, not acted on). `cb status` and `/healthz` both read these
 * two helpers so the two surfaces report the same thing the same way.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { getBoxShapeOrLegacyFallback } from "../lib/box-shape.js";

interface PackageJsonVersion {
  version?: string;
}

async function readVersionField(packageJsonPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as PackageJsonVersion;
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
 * The version of `callback-box` a v2 box has installed in its OWN
 * `node_modules/` (what `cb upgrade` bumps and what a real `pnpm install`
 * resolves). `null` for a legacy (shapeVersion 1) box, which has no
 * separate installed engine — it always runs under whatever process serves
 * it — and `null` if the box's `node_modules/callback-box/package.json`
 * can't be read (not installed yet, or the dev-convenience symlink from
 * `scaffoldPackageRoot` points somewhere unreadable).
 */
export async function getInstalledEngineVersion(boxRoot: string): Promise<string | null> {
  const shape = await getBoxShapeOrLegacyFallback(boxRoot);
  if (shape.shapeVersion === 1) return null;
  return readVersionField(path.join(shape.packageRoot, "node_modules/callback-box/package.json"));
}

export interface EngineVersionReport {
  /** The version of the engine process currently serving this box. */
  serving: string | null;
  /** The version this box has pinned/installed (v2 only; null for legacy). */
  installed: string | null;
  /** True only when both are known and differ. */
  mismatch: boolean;
}

/** Combine the two version reads into the shape `cb status` and `/healthz`
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

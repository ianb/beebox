/**
 * Box manifest — the canonical list of boxes on this machine.
 *
 * Lives at `~/.config/cb/boxes.json`. Both `cb serve` (when no positional
 * arguments are given) and `cb scheduler start` consult this manifest, so
 * the two stay in sync and a new box only needs to be registered in one
 * place.
 *
 * Earlier versions stored just the scheduler's box list at
 * `~/.config/cb/scheduler.json`. We migrate it transparently on first
 * load: when `boxes.json` doesn't exist but `scheduler.json` does, the
 * file is read and rewritten under the new name. The legacy file is left
 * in place as a safety net for downgrades; it isn't authoritative once
 * `boxes.json` exists.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface BoxesConfig {
  /** Absolute paths to box roots. Order is preserved as-written. */
  boxes: string[];
}

const CONFIG_DIR = path.join(os.homedir(), ".config/cb");
const CONFIG_FILE = path.join(CONFIG_DIR, "boxes.json");
const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, "scheduler.json");

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    // access() throws when the path is absent or unreadable; for an
    // existence probe, both mean "not there" — no info to log.
    return false;
  }
}

/**
 * Read the manifest. Falls back to the legacy scheduler.json on first
 * run after upgrade, rewriting it under the new filename so subsequent
 * loads are direct.
 */
export async function loadBoxesConfig(): Promise<BoxesConfig> {
  if (await fileExists(CONFIG_FILE)) {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as BoxesConfig;
  }
  if (await fileExists(LEGACY_CONFIG_FILE)) {
    const content = await fs.readFile(LEGACY_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as BoxesConfig;
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }
  return { boxes: [] };
}

export async function saveBoxesConfig(config: BoxesConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Add a box path to the manifest. No-op if already present.
 * Returns true if added, false if already present.
 */
export async function addBoxToManifest(absPath: string): Promise<boolean> {
  const config = await loadBoxesConfig();
  if (config.boxes.includes(absPath)) return false;
  config.boxes.push(absPath);
  await saveBoxesConfig(config);
  return true;
}

/**
 * Remove a box path from the manifest. Returns true if removed,
 * false if not present.
 */
export async function removeBoxFromManifest(absPath: string): Promise<boolean> {
  const config = await loadBoxesConfig();
  const idx = config.boxes.indexOf(absPath);
  if (idx === -1) return false;
  config.boxes.splice(idx, 1);
  await saveBoxesConfig(config);
  return true;
}

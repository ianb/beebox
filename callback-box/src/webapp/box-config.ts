/**
 * Per-box configuration loader.
 *
 * Reads config/box.json from each box root. Caches results.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface BoxConfig {
  publicUrl?: string;
  allowedEmails?: string[];
}

const cache = new Map<string, { config: BoxConfig; mtime: number }>();

/**
 * Load box config from config/box.json, with simple mtime-based caching.
 */
export async function loadBoxConfig(boxRoot: string): Promise<BoxConfig> {
  const configPath = path.join(boxRoot, "config", "box.json");

  let mtime: number;
  try {
    const stat = await fs.promises.stat(configPath);
    mtime = stat.mtimeMs;
  } catch {
    return {};
  }

  const cached = cache.get(boxRoot);
  if (cached && cached.mtime === mtime) {
    return cached.config;
  }

  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    const config: BoxConfig = JSON.parse(raw);
    cache.set(boxRoot, { config, mtime });
    return config;
  } catch {
    return {};
  }
}

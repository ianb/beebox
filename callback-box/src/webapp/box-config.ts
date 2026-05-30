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
  /** IANA timezone for this box (e.g. "America/Chicago"). Used in all agent prompts. */
  timezone?: string;
  /**
   * Which Google services this box is allowed to use.
   * If missing, no Google services are enabled (safe default).
   * Example: { calendar: true, gmail: false, drive: false }
   */
  googleServices?: Partial<Record<"calendar" | "gmail" | "drive", boolean>>;
}

export type GoogleServiceName = "calendar" | "gmail" | "drive";

const cache = new Map<string, { config: BoxConfig; mtime: number }>();

/**
 * Check if a Google service is allowed for this box.
 * Returns false if googleServices is not configured or the service is not enabled.
 */
export async function isGoogleServiceAllowed(boxRoot: string, service: GoogleServiceName): Promise<boolean> {
  const config = await loadBoxConfig(boxRoot);
  return config.googleServices?.[service] === true;
}

/**
 * Load the box timezone (or null if not configured).
 */
export async function loadBoxTimezone(boxRoot: string): Promise<string | null> {
  const config = await loadBoxConfig(boxRoot);
  return config.timezone ?? null;
}

/**
 * Build a one-line timezone context string for agent prompts.
 * Returns empty string if no timezone is configured.
 */
export async function buildTimezoneContext(boxRoot: string): Promise<string> {
  const tz = await loadBoxTimezone(boxRoot);
  if (!tz) return "";
  return `\nTimezone: ${tz}`;
}

/**
 * Load box config from config/box.json, with simple mtime-based caching.
 */
export async function loadBoxConfig(boxRoot: string): Promise<BoxConfig> {
  const configPath = path.join(boxRoot, "config", "box.json");

  let mtime: number;
  try {
    const stat = await fs.promises.stat(configPath);
    mtime = stat.mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`No box config at ${configPath}, using defaults:`, e);
    }
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
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read or parse box config at ${configPath}, using defaults:`, e);
    }
    return {};
  }
}

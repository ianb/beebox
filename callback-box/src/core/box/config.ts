/**
 * Per-box configuration loader.
 *
 * Reads config/box.json from each box root. Caches results.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";

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
  /**
   * Extra filesystem roots this box's commentary cards may resolve `file:`
   * hrefs under (the dev-only `/api/external` route — see
   * `core/external-ref.ts`). The box's own root is always allowed implicitly;
   * these are additional roots, e.g. a package source tree the box reviews.
   * Absolute paths, with leading `~` expanded to the home directory.
   */
  externalRoots?: string[];
  /**
   * Proactive scheduled-task health alerts (schedule-health-alert.ts).
   * Absent → no proactive alerts for this box (cb health and the
   * session-start snapshot still surface problems). Explicit opt-in
   * because a misdirected alert is worse than no alert.
   */
  healthAlerts?: {
    /** Telegram chat id to send alerts to (the boxholder's DM chat). */
    telegramChat?: string;
  };
}

export type GoogleServiceName = "calendar" | "gmail" | "drive";

const cache = new Map<string, { config: BoxConfig; mtime: number }>();

/** Explicit invalidation after a same-process config mutation. */
export function clearBoxConfigCache(boxRoot: string): void {
  cache.delete(boxRoot);
}

/**
 * Check if a Google service is allowed for this box.
 * Returns false if googleServices is not configured or the service is not enabled.
 */
export async function isGoogleServiceAllowed(boxRoot: string, service: GoogleServiceName): Promise<boolean> {
  const config = await loadBoxConfig(boxRoot);
  return config.googleServices?.[service] === true;
}

/** True when `Intl.DateTimeFormat` accepts `timeZone` as a valid IANA zone — the only reliable way to validate one (no static zone list ships with Node). */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Load the box timezone (or null if not configured or malformed).
 *
 * A typo'd zone (e.g. `"America/Chciago"`) makes `Intl.DateTimeFormat`
 * throw `RangeError` the moment anything tries to use it — and every
 * plate-state/timezone-aware call site in the todo system (the collector,
 * `cb todos`, `todos.list`, the review sweep, session-context's ambient
 * timezone line) does exactly that. Validating HERE, at the one place the
 * raw config value enters the system, means a bad value degrades to the
 * host's own timezone (still wrong, but visibly so — via the warning below
 * — and non-fatal) instead of taking down every one of those call sites
 * with an uncaught `RangeError`. Per the resilient-not-silent boundary rule:
 * loud + degraded, never silent + crashed.
 */
export async function loadBoxTimezone(boxRoot: string): Promise<string | null> {
  const config = await loadBoxConfig(boxRoot);
  const timezone = config.timezone;
  if (timezone === undefined) return null;
  if (!isValidTimeZone(timezone)) {
    console.warn(
      `Box config timezone "${timezone}" is not a valid IANA timezone — falling back to the host timezone.`,
    );
    return null;
  }
  return timezone;
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
    if (errnoCode(e) !== "ENOENT") {
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
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read or parse box config at ${configPath}, using defaults:`, e);
    }
    return {};
  }
}

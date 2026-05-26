/**
 * Requirement checks for scheduled-script `<requires><connector>` declarations.
 *
 * Different connectors store credentials differently:
 *   - Legacy: config/connectors/<name>.secret.json (telegram, raindrop, mistral, ...)
 *   - Google OAuth: shared CB_GOOGLE_TOKENS_FILE + per-box googleServices policy
 *     (gmail, calendar, drive)
 *
 * This module dispatches the "is this connector configured for this box?" check
 * by name. Unknown names fall back to the legacy secret-file lookup so that
 * connectors not yet ported here keep working.
 */
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import * as path from "node:path";
import {
  isGoogleServiceAllowed,
  type GoogleServiceName,
} from "../webapp/box-config.js";
import type { ScheduleRequirements } from "../schemas/scheduled-script.js";

type Predicate = (boxRoot: string) => Promise<boolean>;

function googleServicePredicate(service: GoogleServiceName): Predicate {
  return async (boxRoot) => {
    if (!hasGoogleTokens(boxRoot)) return false;
    return isGoogleServiceAllowed(boxRoot, service);
  };
}

function hasGoogleTokens(boxRoot: string): boolean {
  const central = process.env.CB_GOOGLE_TOKENS_FILE;
  if (central && existsSync(central)) return true;
  const legacy = path.join(boxRoot, "config/connectors/google.secret.json");
  return existsSync(legacy);
}

const registry: Record<string, Predicate> = {
  gmail: googleServicePredicate("gmail"),
  calendar: googleServicePredicate("calendar"),
  drive: googleServicePredicate("drive"),
  // Older cards used "google" as the connector name for calendar.
  google: googleServicePredicate("calendar"),
};

async function legacySecretPresent(boxRoot: string, name: string): Promise<boolean> {
  try {
    await access(path.join(boxRoot, "config/connectors", `${name}.secret.json`));
    return true;
  } catch {
    return false;
  }
}

export async function checkMissingConnectors(
  boxRoot: string,
  requires: ScheduleRequirements,
): Promise<string[]> {
  const missing: string[] = [];
  for (const name of requires.connectors) {
    const predicate = registry[name];
    const ok = predicate
      ? await predicate(boxRoot)
      : await legacySecretPresent(boxRoot, name);
    if (!ok) missing.push(name);
  }
  return missing;
}

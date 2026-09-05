/**
 * Requirement checks for scheduled-script `<requires><connector>` declarations.
 *
 * Different connectors hold credentials differently:
 *   - The machine secret store: a grant to this box's slug, with a value
 *     (`docs/secrets.md`) — where every migrated connector now lives.
 *   - Legacy: _config/connectors/<name>.secret.json — the transition-window
 *     fallback, still authoritative for a box that has not migrated.
 *   - Google OAuth: shared BBX_GOOGLE_TOKENS_FILE + per-box googleServices policy
 *     (gmail, calendar, drive).
 *
 * This module dispatches the "is this connector configured for this box?" check
 * by name. Names with no special entry are satisfied by EITHER a granted store
 * entry or a legacy file — checking only the file would have made a fully
 * migrated box report its connectors as missing and skip every scheduled script
 * that requires one.
 */
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import * as path from "node:path";
import {
  isGoogleServiceAllowed,
  type GoogleServiceName,
} from "../core/box/config.js";
import { loadSecretStore } from "../core/secrets/store.js";
import { boxSlug } from "../lib/box-slug.js";
import { getBoxDir } from "../lib/paths.js";
import type { ScheduleRequirements } from "../schemas/scheduled-script.js";

type Predicate = (boxRoot: string) => Promise<boolean>;

function googleServicePredicate(service: GoogleServiceName): Predicate {
  return async (boxRoot) => {
    if (!hasGoogleTokens(boxRoot)) return false;
    return isGoogleServiceAllowed(boxRoot, service);
  };
}

function hasGoogleTokens(boxRoot: string): boolean {
  const central = process.env.BBX_GOOGLE_TOKENS_FILE;
  if (central && existsSync(central)) return true;
  const legacy = path.join(getBoxDir(boxRoot, "connectors"), "google.secret.json");
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
    await access(path.join(getBoxDir(boxRoot, "connectors"), `${name}.secret.json`));
    return true;
  } catch (_e) {
    // access() failing here means the secret file isn't present/readable, which
    // is exactly the "not configured" answer this probe returns. The error
    // carries no information beyond that boolean.
    return false;
  }
}

/**
 * Store names that do not match their connector name. `telegram-bot/<slug>`
 * predates this check (the store name was chosen to say what the credential is,
 * the connector name to say what syncs), so the mapping is stated rather than
 * derived.
 */
const storeNameAliases: Record<string, string> = { telegram: "telegram-bot" };

/**
 * Connector families that exist ONLY in the per-box `name/<slug>` form. Telegram
 * reads exactly `telegram-bot/<slug>` (`telegram-helpers.ts`), so a flat
 * `telegram-bot` grant would make this probe say "configured" while the
 * connector still finds nothing — a script that runs and fails instead of
 * skipping cleanly.
 */
const perBoxOnly = new Set(["telegram-bot"]);

/**
 * Is this connector's credential in the machine store, granted to this box AND
 * holding a value? A granted-but-empty slot is a declared intention, not a
 * configured connector, so it counts as missing — the script would fail the
 * same way it does with no grant at all.
 */
async function storeSecretPresent(boxRoot: string, name: string): Promise<boolean> {
  const loaded = await loadSecretStore();
  if (!loaded.ok) return false;
  const slug = await boxSlug(boxRoot);
  const grants = loaded.value.grants[slug];
  if (grants === undefined) return false;
  const base = storeNameAliases[name] ?? name;
  // Both the flat name and the per-box `name/<slug>` instance count, except for
  // families that only ever exist per box.
  const candidates = perBoxOnly.has(base) ? [`${base}/${slug}`] : [base, `${base}/${slug}`];
  for (const candidate of candidates) {
    if (grants[candidate] === undefined) continue;
    const value = loaded.value.secrets[candidate]?.value;
    if (value !== undefined && value !== "") return true;
  }
  return false;
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
      : (await storeSecretPresent(boxRoot, name)) || (await legacySecretPresent(boxRoot, name));
    if (!ok) missing.push(name);
  }
  return missing;
}

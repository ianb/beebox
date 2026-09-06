/**
 * Requirement checks for scheduled-script `<requires><connector>` declarations.
 *
 * Different connectors hold credentials differently:
 *   - The machine secret store: a grant to this box's slug, with a value
 *     (`docs/secrets.md`) — where every migrated connector now lives.
 *   - Google OAuth: three things at once — the shared BBX_GOOGLE_TOKENS_FILE
 *     record, the per-box `googleServices` policy, and a box grant for the
 *     OAuth app's client credentials (gmail, calendar, drive).
 *
 * This module dispatches the "is this connector configured for this box?" check
 * by name. Names with no special entry need a granted store entry. A retired
 * `<name>.secret.json` in the box tree does NOT count: nothing reads those
 * files any more, so treating one as configuration would start a scheduled
 * script that then fails for want of a credential.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  isGoogleServiceAllowed,
  type GoogleServiceName,
} from "../core/box/config.js";
import { getBoxGoogleClientCreds } from "./google-auth.js";
import { loadSecretStore } from "../core/secrets/store.js";
import { boxSlug } from "../lib/box-slug.js";
import { getBoxDir } from "../lib/paths.js";
import type { ScheduleRequirements } from "../schemas/scheduled-script.js";

type Predicate = (boxRoot: string) => Promise<boolean>;

/**
 * A Google connector needs all three of: an authorization record, permission
 * from this box's policy, and a grant for the OAuth app's client credentials.
 *
 * The client-credential grant is the one that is easy to forget, and skipping
 * the check here is worse than a missing credential: `getGoogleAuth` returns
 * null without it, so Calendar and Gmail silently no-op and Drive reports a
 * sync failure — a script that ran and did nothing, rather than one the
 * scheduler skipped cleanly with a named reason.
 */
function googleServicePredicate(service: GoogleServiceName): Predicate {
  return async (boxRoot) => {
    if (!hasGoogleTokens(boxRoot)) return false;
    if ((await getBoxGoogleClientCreds(boxRoot)) === null) return false;
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
      : await storeSecretPresent(boxRoot, name);
    if (!ok) missing.push(name);
  }
  return missing;
}

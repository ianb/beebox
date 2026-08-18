/**
 * The one-time migration from per-box `config/connectors/*.secret.json` files
 * into the machine-level store (`docs/plans/secret-custody.md`, "Rollout
 * shape": *Migration*).
 *
 * It plans, then applies. Planning reads every box's connector directory, maps
 * each legacy filename to the store name its READER now asks for (the table in
 * `docs/secrets.md` is this module's contract — a name it gets wrong produces
 * an entry nobody resolves), and dedupes identical values across boxes into one
 * shared entry with a grant per box. Applying writes the whole plan under ONE
 * store lock.
 *
 * Four deliberate properties:
 *
 * - **The originals stay.** This is the transition window: every reader still
 *   falls back to the in-tree file, so a mis-migrated box keeps working and the
 *   removal pass is a separate, later act.
 * - **Never a value in the output.** Every summary line is a name, a count, or
 *   a slug. Values move file → store and are not printed, logged, or compared
 *   in any message.
 * - **Existing entries are never overwritten.** A name already in the store is
 *   reported as already-migrated (or as a conflict, when a box's file disagrees
 *   with what is stored) and left exactly as it is. Re-running is a no-op.
 * - **A multi-field credential becomes the JSON string its consumer parses**,
 *   validated here against the same shape the consumer's own zod schema
 *   requires, with keys written in a fixed order so two boxes holding the same
 *   credential dedupe rather than looking different.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { getBoxShapeIfPresent, resolveOperationalRoot } from "../../lib/box-shape.js";
import { boxSlug } from "../../lib/box-slug.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { loadBoxesConfig } from "../box/boxes-config.js";
import { mutateSecretStore, type SecretStoreData } from "./store.js";

/** Where a legacy file's contents belong in the store. */
interface LegacyMapping {
  /** The store name, given the holding box's slug. */
  storeName: (slug: string) => string;
  /** Single-box entries carry `owningBox` + `shareable: false`. */
  singleBox: boolean;
  /** Turn the file's parsed JSON into the opaque string the reader expects. */
  toValue: (json: unknown) => string | null;
}

/** A single-field key file: `{"apiKey": "…"}` → the bare key string. */
const apiKeyFileSchema = z.object({ apiKey: z.string().min(1) });

function apiKeyValue(json: unknown): string | null {
  const parsed = apiKeyFileSchema.safeParse(json);
  return parsed.success ? parsed.data.apiKey : null;
}

/**
 * Re-serialize a multi-field credential in a FIXED key order. Two boxes holding
 * the same credential must produce byte-identical values or the dedupe below
 * would split them into two entries over nothing but key order.
 */
function jsonValue<T extends z.ZodRawShape>(schema: z.ZodObject<T>, order: string[]): (json: unknown) => string | null {
  return (json) => {
    const parsed = schema.safeParse(json);
    if (!parsed.success) return null;
    const fields: Record<string, unknown> = parsed.data;
    const ordered: Record<string, unknown> = {};
    for (const key of order) ordered[key] = fields[key];
    return JSON.stringify(ordered);
  };
}

const deepgramSchema = z.object({ apiKey: z.string().min(1), projectId: z.string().min(1) });
const telegramSchema = z.object({ botToken: z.string().min(1), webhookSecret: z.string().min(1) });
const publishSchema = z.object({
  accountId: z.string().min(1),
  bucket: z.string().min(1),
  apiToken: z.string().min(1),
});

function sharedKey(name: string): LegacyMapping {
  return { storeName: () => name, singleBox: false, toValue: apiKeyValue };
}

/**
 * Legacy basename → store name, mirroring `docs/secrets.md`'s table. A file
 * NOT listed here is left alone and reported: `google.secret.json` and
 * `gmail.secret.json` hold OAuth *tokens*, which this plan deliberately does
 * not move (`google-token-store.ts` keeps them), and inventing a name for an
 * unrecognized file would create an entry no reader ever asks for.
 */
const LEGACY_MAPPINGS: Record<string, LegacyMapping> = {
  mistral: sharedKey("mistral"),
  openai: sharedKey("openai"),
  anthropic: sharedKey("anthropic"),
  replicate: sharedKey("replicate"),
  deepgram: {
    storeName: () => "deepgram",
    singleBox: false,
    toValue: jsonValue(deepgramSchema, ["apiKey", "projectId"]),
  },
  telegram: {
    storeName: (slug) => `telegram-bot/${slug}`,
    singleBox: true,
    toValue: jsonValue(telegramSchema, ["botToken", "webhookSecret"]),
  },
  publish: {
    storeName: (slug) => `publish/${slug}`,
    singleBox: true,
    toValue: jsonValue(publishSchema, ["accountId", "bucket", "apiToken"]),
  },
};

/** One box's legacy file, already mapped and read. */
interface FoundSecret {
  slug: string;
  /** The legacy file's path, for the operator's own follow-up. */
  file: string;
  storeName: string;
  singleBox: boolean;
  value: string;
}

/** A file that will NOT be migrated, and why. */
export interface MigrationSkip {
  file: string;
  reason: string;
}

/** One store entry the migration would create, and who gets a grant. */
export interface PlannedEntry {
  name: string;
  /** Slugs granted `server` access to this entry. */
  grants: string[];
  singleBox: boolean;
  /** The owning slug for a single-box entry. */
  owningBox: string | undefined;
  /** Not written — the value already exists in the store under this name. */
  alreadyInStore: boolean;
  value: string;
}

/** A box whose file disagrees with another box's under the same store name. */
export interface MigrationConflict {
  /** The name the READER asks for — the one that could not hold both values. */
  contestedName: string;
  slug: string;
  /** The per-box name this box's value was parked under instead. */
  parkedAs: string;
}

export interface MigrationPlan {
  boxes: { slug: string; boxRoot: string }[];
  entries: PlannedEntry[];
  conflicts: MigrationConflict[];
  skipped: MigrationSkip[];
}

/**
 * The boxes to migrate: every box under `root` (one level down, package roots
 * or content roots alike), or — with no `root` — the machine's registered box
 * list, `~/.config/cb/boxes.json`. The manifest is the better default: it is
 * what the scheduler actually runs, so it cannot include a stale checkout that
 * merely happens to sit beside the real ones.
 */
export async function migrationBoxRoots(opts: { root: string | undefined }): Promise<string[]> {
  if (opts.root === undefined) {
    const config = await loadBoxesConfig();
    return config.boxes;
  }
  const entries = await fs.readdir(opts.root, { withFileTypes: true });
  const roots: string[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(opts.root, entry.name);
    const resolved = await resolveOperationalRoot(candidate);
    const shape = await getBoxShapeIfPresent(resolved);
    if (shape.found) roots.push(resolved);
  }
  return roots;
}

/** Read one box's `config/connectors/*.secret.json` files into mapped values. */
async function readBoxSecrets(opts: {
  boxRoot: string;
  slug: string;
  skipped: MigrationSkip[];
}): Promise<FoundSecret[]> {
  const dir = path.join(opts.boxRoot, "config", "connectors");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    // No connectors directory at all is the ordinary case for a fresh box.
    if (errnoCode(e) !== "ENOENT") {
      opts.skipped.push({ file: dir, reason: `could not be read (${errorMessage(e)})` });
    }
    return [];
  }
  const found: FoundSecret[] = [];
  for (const name of names.toSorted()) {
    if (!name.endsWith(".secret.json")) continue;
    const file = path.join(dir, name);
    const base = name.slice(0, -".secret.json".length);
    const mapping = LEGACY_MAPPINGS[base];
    if (mapping === undefined) {
      opts.skipped.push({ file, reason: `no store name is defined for "${base}" — left in place` });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch (e) {
      opts.skipped.push({ file, reason: `unreadable or not valid JSON (${errorMessage(e)})` });
      continue;
    }
    const value = mapping.toValue(json);
    if (value === null) {
      opts.skipped.push({ file, reason: "does not hold the fields this credential needs" });
      continue;
    }
    found.push({ slug: opts.slug, file, storeName: mapping.storeName(opts.slug), singleBox: mapping.singleBox, value });
  }
  return found;
}

/**
 * Group the found files into store entries.
 *
 * Boxes sharing one value share one entry — the whole point of the store, and
 * what makes rotation touch one place. Boxes whose values DISAGREE under the
 * same name cannot: the first slug (alphabetically, so the choice is stable
 * across runs) keeps the plain name every reader asks for, and each other box's
 * value is parked under `name/<slug>` and reported as a conflict. A parked
 * entry is not what its reader looks up — that box keeps working through its
 * legacy file, which this migration leaves in place, until the boxholder
 * decides which key that box should actually use.
 */
function planEntries(found: FoundSecret[], store: SecretStoreData): { entries: PlannedEntry[]; conflicts: MigrationConflict[] } {
  const byName = new Map<string, FoundSecret[]>();
  for (const secret of found) {
    const list = byName.get(secret.storeName) ?? [];
    list.push(secret);
    byName.set(secret.storeName, list);
  }

  const entries: PlannedEntry[] = [];
  const conflicts: MigrationConflict[] = [];
  for (const name of [...byName.keys()].toSorted()) {
    const holders = (byName.get(name) ?? []).toSorted((a, b) => a.slug.localeCompare(b.slug));
    const first = holders[0];
    if (first === undefined) continue;
    const agreeing = holders.filter((holder) => holder.value === first.value);
    const disagreeing = holders.filter((holder) => holder.value !== first.value);

    entries.push({
      name,
      grants: agreeing.map((holder) => holder.slug),
      singleBox: first.singleBox,
      owningBox: first.singleBox ? first.slug : undefined,
      alreadyInStore: store.secrets[name]?.value !== undefined,
      value: first.value,
    });

    for (const holder of disagreeing) {
      const parkedAs = `${name}/${holder.slug}`;
      conflicts.push({ contestedName: name, slug: holder.slug, parkedAs });
      entries.push({
        name: parkedAs,
        grants: [holder.slug],
        singleBox: true,
        owningBox: holder.slug,
        alreadyInStore: store.secrets[parkedAs]?.value !== undefined,
        value: holder.value,
      });
    }
  }
  return { entries, conflicts };
}

/** Build the plan without writing anything — what `--dry-run` prints. */
export async function planSecretMigration(opts: { root: string | undefined }): Promise<MigrationPlan> {
  const roots = await migrationBoxRoots({ root: opts.root });
  const skipped: MigrationSkip[] = [];
  const boxes: { slug: string; boxRoot: string }[] = [];
  const found: FoundSecret[] = [];
  for (const boxRoot of roots) {
    const slug = await boxSlug(boxRoot);
    boxes.push({ slug, boxRoot });
    found.push(...(await readBoxSecrets({ boxRoot, slug, skipped })));
  }
  // Planning reads the store so an already-migrated name is reported rather
  // than rewritten; applying re-reads it under the lock and decides again.
  const plan = await mutateSecretStore({ purpose: "migrate-plan" }, (store) => planEntries(found, store));
  return { boxes, entries: plan.entries, conflicts: plan.conflicts, skipped };
}

/** What {@link applySecretMigration} actually wrote. */
export interface MigrationResult {
  created: string[];
  /** Names left untouched because the store already holds a value for them. */
  untouched: string[];
  /** `<slug>:<name>` pairs newly granted. */
  granted: string[];
}

/**
 * Write the plan: one locked pass, entries then grants. An existing entry is
 * never rewritten (its grants still are — a box added later must be able to
 * join a name that is already in the store).
 */
export async function applySecretMigration(plan: MigrationPlan): Promise<MigrationResult> {
  return mutateSecretStore({ purpose: "migrate" }, (store) => {
    const result: MigrationResult = { created: [], untouched: [], granted: [] };
    const now = getBoxTimeISO();
    for (const entry of plan.entries) {
      const existing = store.secrets[entry.name];
      if (existing?.value !== undefined && existing.value !== "") {
        result.untouched.push(entry.name);
      } else {
        store.secrets[entry.name] = {
          ...existing,
          value: entry.value,
          updated: now,
          note: existing?.note ?? "migrated from a per-box config/connectors file",
          owningBox: entry.owningBox ?? existing?.owningBox,
          shareable: entry.singleBox ? false : existing?.shareable,
        };
        result.created.push(entry.name);
      }
      for (const slug of entry.grants) {
        const boxGrants = store.grants[slug] ?? {};
        if (boxGrants[entry.name] === undefined) {
          // Always `server`: every legacy connector file feeds server-process
          // code. Raising a grant to `agent` is a boxholder decision, never a
          // migration's.
          boxGrants[entry.name] = "server";
          result.granted.push(`${slug}:${entry.name}`);
        }
        store.grants[slug] = boxGrants;
      }
    }
    return result;
  });
}

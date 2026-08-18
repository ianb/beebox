/**
 * Store lifecycle operations — set, remove, declare, grant, revoke, list,
 * status (`docs/plans/secret-custody.md`, Track 2).
 *
 * These are the writes behind `cb secrets`, and later behind the admin page's
 * Secrets section and the chat capture widget: one implementation, three
 * surfaces. They mutate under the store's lock and never return a value —
 * reading a secret is `resolveSecret`'s job and nothing else's, which is why
 * {@link listSecrets} returns metadata with a `hasValue` boolean instead of the
 * value itself.
 *
 * Failures here throw (`SecretLifecycleError`): a caller that just asked to
 * grant something cannot branch usefully on why it could not, it reports.
 */

import { getBoxTimeISO } from "../../lib/time.js";
import {
  EmptySecretValueError,
  SecretGrantNotFoundError,
  SecretNotFoundError,
  SecretNotShareableError,
  SecretStoreAccessError,
} from "./errors.js";
import { probeSecretInBackground } from "./probe-registry.js";
import {
  loadSecretStore,
  mutateSecretStore,
  secretsFilePath,
  type SecretAccessLevel,
  type SecretEntry,
  type SecretStoreData,
} from "./store.js";

/** Metadata for one entry — never the value. */
export interface SecretListing {
  name: string;
  hasValue: boolean;
  note: string | undefined;
  updated: string;
  formatHint: string | undefined;
  verified: SecretEntry["verified"];
  owningBox: string | undefined;
  shareable: boolean | undefined;
  /** The box whose agent declared this slot, when one did (attribution only). */
  declaredBy: string | undefined;
  /** Box slug → access level, across every box on the machine. */
  grants: Record<string, SecretAccessLevel>;
  lastUsed: Record<string, string> | undefined;
}

/** What one box has, needs, and is stale about. */
export interface BoxSecretStatus {
  slug: string;
  granted: { name: string; access: SecretAccessLevel; hasValue: boolean }[];
  /** Granted names whose entry exists but holds no value yet. */
  emptySlots: string[];
  /** Granted names whose entry no longer exists. */
  danglingGrants: string[];
  /**
   * Slots this box's agent declared that it holds no grant for — what it asked
   * for and is still waiting on. Without this a declared slot vanishes from the
   * box's own view the moment it is created (declaring grants nothing), which
   * is exactly the state an agent needs to be able to report.
   */
  declaredHere: { name: string; hasValue: boolean }[];
}

function requireEntry(store: SecretStoreData, name: string): SecretEntry {
  const entry = store.secrets[name];
  if (entry === undefined) throw new SecretNotFoundError(name);
  return entry;
}

/**
 * Create or replace a secret's value. `set` on an existing name is a ROTATION:
 * one copy changes and every grant follows it, which is the property the
 * copy-the-file-between-boxes status quo could not offer.
 */
export async function setSecret(opts: {
  name: string;
  value: string;
  note?: string | undefined;
  formatHint?: string | undefined;
  owningBox?: string | undefined;
  shareable?: boolean | undefined;
}): Promise<void> {
  if (opts.value === "") throw new EmptySecretValueError();
  await mutateSecretStore({ purpose: "set" }, (store) => {
    const existing = store.secrets[opts.name];
    store.secrets[opts.name] = {
      ...existing,
      value: opts.value,
      updated: getBoxTimeISO(),
      note: opts.note ?? existing?.note,
      formatHint: opts.formatHint ?? existing?.formatHint,
      owningBox: opts.owningBox ?? existing?.owningBox,
      shareable: opts.shareable ?? existing?.shareable,
      // A rotated value invalidates whatever the last probe concluded.
      verified: undefined,
    };
  });
  probeSecretInBackground(opts.name);
}

/**
 * Declare an empty, ungranted slot: name + note, no value. This is the AGENT's
 * surface — an agent writing an integration can say what it needs, and only the
 * boxholder can fill or grant it. Idempotent: re-declaring an existing name
 * refreshes its note/hint and never clobbers a value.
 */
export async function declareSecret(opts: {
  name: string;
  note?: string | undefined;
  formatHint?: string | undefined;
  /** Slug of the box that asked for the slot, for `status` attribution. */
  declaredBy?: string | undefined;
}): Promise<{ created: boolean }> {
  return mutateSecretStore({ purpose: "declare" }, (store) => {
    const existing = store.secrets[opts.name];
    store.secrets[opts.name] = {
      ...existing,
      value: existing?.value,
      updated: existing?.updated ?? getBoxTimeISO(),
      note: opts.note ?? existing?.note,
      formatHint: opts.formatHint ?? existing?.formatHint,
      declaredBy: opts.declaredBy ?? existing?.declaredBy,
    };
    return { created: existing === undefined };
  });
}

/** Remove an entry. Grants that named it deliberately survive, so the resolver
 *  reports `dangling-grant` (a stale grant to clean up) rather than the
 *  misleading `unknown-secret`. */
export async function removeSecret(name: string): Promise<void> {
  await mutateSecretStore({ purpose: "rm" }, (store) => {
    requireEntry(store, name);
    delete store.secrets[name];
  });
}

/**
 * Grant a box access to a secret. Refuses for a single-box secret (a Telegram
 * bot token binds to one webhook URL — a second grant would not merely be
 * unwise, it would break routing), which is why the refusal explains rather
 * than just denying.
 */
export async function grantSecret(opts: { slug: string; name: string; access: SecretAccessLevel }): Promise<void> {
  await mutateSecretStore({ purpose: "grant" }, (store) => {
    const entry = requireEntry(store, opts.name);
    if (entry.shareable === false && entry.owningBox !== opts.slug) {
      throw new SecretNotShareableError({ secretName: opts.name, owningBox: entry.owningBox, boxSlug: opts.slug });
    }
    const boxGrants = store.grants[opts.slug] ?? {};
    boxGrants[opts.name] = opts.access;
    store.grants[opts.slug] = boxGrants;
  });
}

/**
 * Store a single-box secret AND grant it to that box, in one locked pass.
 *
 * The programmatic form of `set` + `grant` for per-box connector flows that own
 * both halves — telegram setup, publish's minted R2 token. They differ from the
 * boxholder's `cb secrets set`/`grant` in that there is no separate granting
 * decision to make: the box just minted or was handed a credential that is
 * structurally its own, so the entry carries `owningBox` + `shareable: false`
 * (a Telegram bot token binds to one webhook URL; the R2 token is scoped to one
 * bucket) and the grant follows automatically. `grantSecret` would refuse the
 * second step on its own `shareable: false` check if the entry already existed
 * for a different box — the ownership check runs here too, so a flow can never
 * quietly steal another box's entry. That check reads the STORED owner and
 * ignores what the caller passed: an entry owned by another box is refused even
 * when `opts.owningBox` claims otherwise.
 *
 * Doing both under ONE lock also means there is no window in which the value
 * exists ungranted: a concurrent resolve either sees the old state or the new
 * one.
 */
export async function setAndGrantSecret(opts: {
  name: string;
  value: string;
  slug: string;
  access: SecretAccessLevel;
  note?: string | undefined;
  owningBox?: string | undefined;
  shareable?: boolean | undefined;
}): Promise<void> {
  if (opts.value === "") throw new EmptySecretValueError();
  await mutateSecretStore({ purpose: "set-and-grant" }, (store) => {
    const existing = store.secrets[opts.name];
    // Ownership is read off the STORE, never off the caller's options: an
    // `opts.owningBox ?? existing?.owningBox` would let a flow name itself the
    // owner of an entry another box already owns and pass its own check. An
    // existing owner is therefore decisive — a different caller is refused
    // outright, and `opts.owningBox` may only introduce ownership on a new
    // entry (or restate the owner an existing entry already has).
    const existingOwner = existing?.owningBox;
    if (existingOwner !== undefined && existingOwner !== opts.slug) {
      throw new SecretNotShareableError({ secretName: opts.name, owningBox: existingOwner, boxSlug: opts.slug });
    }
    if (opts.owningBox !== undefined && existingOwner !== undefined && opts.owningBox !== existingOwner) {
      throw new SecretNotShareableError({ secretName: opts.name, owningBox: existingOwner, boxSlug: opts.owningBox });
    }
    const owningBox = existingOwner ?? opts.owningBox;
    store.secrets[opts.name] = {
      ...existing,
      value: opts.value,
      updated: getBoxTimeISO(),
      note: opts.note ?? existing?.note,
      owningBox,
      shareable: opts.shareable ?? existing?.shareable,
      // A rotated value invalidates whatever the last probe concluded.
      verified: undefined,
    };
    const boxGrants = store.grants[opts.slug] ?? {};
    boxGrants[opts.name] = opts.access;
    store.grants[opts.slug] = boxGrants;
  });
  probeSecretInBackground(opts.name);
}

/**
 * Revoke a box's grant AND drop the entry, in one locked pass — the disconnect
 * counterpart of {@link setAndGrantSecret} for a secret that belongs to exactly
 * one box. Idempotent by design: disconnect must succeed whether or not the box
 * ever had the secret, and must not leave a dangling grant behind.
 */
export async function forgetBoxSecret(opts: { name: string; slug: string }): Promise<void> {
  await mutateSecretStore({ purpose: "forget" }, (store) => {
    const boxGrants = store.grants[opts.slug];
    if (boxGrants !== undefined) {
      delete boxGrants[opts.name];
      if (Object.keys(boxGrants).length === 0) delete store.grants[opts.slug];
    }
    delete store.secrets[opts.name];
  });
}

/** What {@link copyBoxGrants} did, per name — never a value. */
export interface CopiedGrants {
  copied: { name: string; access: SecretAccessLevel }[];
  /** Names deliberately not copied, each with the reason to print. */
  skipped: { name: string; reason: string }[];
  /**
   * Did the source box hold ANY grant at all? Distinct from "copied nothing":
   * a source whose only grants are single-box copies nothing either, and
   * `deploy/add-box.sh` must not read that as "this machine predates the store"
   * and fall back to copying secret FILES — which would hand the new box the
   * very Telegram token the skip just refused.
   */
  sourceHadGrants: boolean;
}

/**
 * Give one box the same grants another box already holds — what
 * `deploy/add-box.sh --secrets-from` does now that provisioning a box is a
 * grant, not a file copy. Access levels come across unchanged: a source box's
 * `agent` grant was a deliberate disclosure decision, and silently downgrading
 * it would leave the new box's code failing with `agent-access-not-granted`
 * for no visible reason.
 *
 * Single-box secrets (`shareable: false` — a Telegram bot token, a bucket-scoped
 * R2 token) are SKIPPED rather than refused: a whole provisioning run must not
 * fail because the reference box happens to have a Telegram bot, and copying one
 * would break the box already using it. Each skip is reported so the operator
 * sees what the new box still needs of its own.
 */
export async function copyBoxGrants(opts: { fromSlug: string; toSlug: string }): Promise<CopiedGrants> {
  return mutateSecretStore({ purpose: "copy-grants" }, (store) => {
    const source = store.grants[opts.fromSlug] ?? {};
    const result: CopiedGrants = { copied: [], skipped: [], sourceHadGrants: Object.keys(source).length > 0 };
    const target = store.grants[opts.toSlug] ?? {};
    for (const name of Object.keys(source).toSorted()) {
      const access = source[name];
      if (access === undefined) continue;
      const entry = store.secrets[name];
      if (entry === undefined) {
        result.skipped.push({ name, reason: `"${opts.fromSlug}" holds a stale grant for it (no such secret)` });
        continue;
      }
      if (entry.shareable === false) {
        result.skipped.push({
          name,
          reason: `single-box secret (belongs to "${entry.owningBox ?? opts.fromSlug}") — set this box up with its own`,
        });
        continue;
      }
      target[name] = access;
      result.copied.push({ name, access });
    }
    if (result.copied.length > 0) store.grants[opts.toSlug] = target;
    return result;
  });
}

/** Withdraw a box's grant. Removing the last one drops the box's whole map. */
export async function revokeSecret(opts: { slug: string; name: string }): Promise<void> {
  await mutateSecretStore({ purpose: "revoke" }, (store) => {
    const boxGrants = store.grants[opts.slug];
    if (boxGrants?.[opts.name] === undefined) {
      throw new SecretGrantNotFoundError({ secretName: opts.name, boxSlug: opts.slug });
    }
    delete boxGrants[opts.name];
    if (Object.keys(boxGrants).length === 0) delete store.grants[opts.slug];
  });
}

async function loadOrThrow(): Promise<SecretStoreData> {
  const loaded = await loadSecretStore();
  if (loaded.ok) return loaded.value;
  throw new SecretStoreAccessError({ storePath: secretsFilePath(), detail: loaded.error, refusingWrite: false });
}

/** Every entry's metadata, name-sorted. Values never leave this module. */
export async function listSecrets(): Promise<SecretListing[]> {
  const store = await loadOrThrow();
  return Object.entries(store.secrets)
    .map(([name, entry]): SecretListing => {
      const grants: Record<string, SecretAccessLevel> = {};
      for (const [slug, names] of Object.entries(store.grants)) {
        const access = names[name];
        if (access !== undefined) grants[slug] = access;
      }
      return {
        name,
        hasValue: entry.value !== undefined && entry.value !== "",
        note: entry.note,
        updated: entry.updated,
        formatHint: entry.formatHint,
        verified: entry.verified,
        owningBox: entry.owningBox,
        shareable: entry.shareable,
        declaredBy: entry.declaredBy,
        grants,
        lastUsed: entry.lastUsed,
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * One box's view: what it is granted, which of those slots are still empty, and
 * which grants have gone stale. Deliberately scoped to this box — an agent must
 * not get an inventory of every secret on the machine to hunt for.
 */
export async function boxSecretStatus(slug: string): Promise<BoxSecretStatus> {
  const store = await loadOrThrow();
  const boxGrants = store.grants[slug] ?? {};
  const status: BoxSecretStatus = { slug, granted: [], emptySlots: [], danglingGrants: [], declaredHere: [] };
  for (const name of Object.keys(boxGrants).toSorted()) {
    const access = boxGrants[name];
    if (access === undefined) continue;
    const entry = store.secrets[name];
    if (entry === undefined) {
      status.danglingGrants.push(name);
      continue;
    }
    const hasValue = entry.value !== undefined && entry.value !== "";
    status.granted.push({ name, access, hasValue });
    if (!hasValue) status.emptySlots.push(name);
  }
  for (const name of Object.keys(store.secrets).toSorted()) {
    const entry = store.secrets[name];
    if (entry?.declaredBy !== slug) continue;
    if (boxGrants[name] !== undefined) continue; // already reported as granted
    status.declaredHere.push({ name, hasValue: entry.value !== undefined && entry.value !== "" });
  }
  return status;
}

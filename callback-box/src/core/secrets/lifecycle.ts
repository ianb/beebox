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
}): Promise<{ created: boolean }> {
  return mutateSecretStore({ purpose: "declare" }, (store) => {
    const existing = store.secrets[opts.name];
    store.secrets[opts.name] = {
      ...existing,
      value: existing?.value,
      updated: existing?.updated ?? getBoxTimeISO(),
      note: opts.note ?? existing?.note,
      formatHint: opts.formatHint ?? existing?.formatHint,
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
 * quietly steal another box's entry.
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
    const owningBox = opts.owningBox ?? existing?.owningBox;
    if (existing?.shareable === false && owningBox !== undefined && owningBox !== opts.slug) {
      throw new SecretNotShareableError({ secretName: opts.name, owningBox, boxSlug: opts.slug });
    }
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
  const status: BoxSecretStatus = { slug, granted: [], emptySlots: [], danglingGrants: [] };
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
  return status;
}

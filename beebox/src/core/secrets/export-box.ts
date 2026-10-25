/**
 * One box's share of the machine secret store, as a store of its own.
 *
 * On a unit host each box reads `~/.config/beebox/secrets.json` under its own
 * home (the identity subplan, per-box-units.subplan.md): a store holding only
 * the secrets that box is granted, with their values, and that box's publish
 * records. The hub user's master store stays the place grants are made; the
 * migration and `add-box.sh` copy a box's share with this and verify it with
 * `grantNamesFor`. Nothing here prints; the CLI (`bbx engine secrets
 * export-box`) is the one place a value leaves the store, into a 0600 file
 * the box user owns.
 */

import { loadSecretStore, type SecretStoreData } from "./store.js";
import { SecretStoreAccessError } from "./errors.js";
import { secretsFilePath } from "./store.js";

/** The master store, or a loud failure: an export must never read as empty by accident. */
async function loadOrThrow(): Promise<SecretStoreData> {
  const loaded = await loadSecretStore();
  if (loaded.ok) return loaded.value;
  throw new SecretStoreAccessError({ storePath: secretsFilePath(), detail: loaded.error, refusingWrite: false });
}

/** The grant names `store` holds for `slug`, sorted; the thing a copy is verified against. */
export function grantNamesFor(store: SecretStoreData, slug: string): string[] {
  return Object.keys(store.grants[slug] ?? {}).toSorted();
}

/**
 * A store holding only what `slug` may read: its granted secrets (values and
 * all), its grants, and the publish connections, bindings and hosts bound to
 * it. A grant for a secret the master no longer holds is dropped, as
 * `copyBoxGrants` drops it.
 */
export function boxShareOf(store: SecretStoreData, slug: string): SecretStoreData {
  const grants = store.grants[slug] ?? {};
  const secrets: SecretStoreData["secrets"] = {};
  const share: SecretStoreData["grants"][string] = {};
  for (const [name, access] of Object.entries(grants)) {
    const entry = store.secrets[name];
    if (entry === undefined) continue;
    secrets[name] = entry;
    share[name] = access;
  }
  const bindings = Object.fromEntries(Object.entries(store.cloudflarePublishBindings ?? {}).filter(([, binding]) => binding.boxSlug === slug));
  const connectionNames = new Set(Object.values(bindings).map((binding) => binding.connectionName));
  const connections = Object.fromEntries(
    Object.entries(store.cloudflarePublishConnections ?? {})
      .filter(([name, connection]) => connectionNames.has(name) || connection.grants[slug] !== undefined)
      .map(([name, connection]) => [name, { ...connection, grants: connection.grants[slug] === undefined ? {} : { [slug]: connection.grants[slug] } }]),
  );
  const hosts = Object.fromEntries(Object.entries(store.cloudflarePublishBoxHosts ?? {}).filter(([key]) => key === slug));
  return {
    secrets,
    grants: Object.keys(share).length > 0 ? { [slug]: share } : {},
    cloudflarePublishConnections: connections,
    cloudflarePublishBindings: bindings,
    ...(Object.keys(hosts).length > 0 && { cloudflarePublishBoxHosts: hosts }),
  };
}

/** `boxShareOf` over the machine store this process reads. */
export async function exportBoxStore(slug: string): Promise<SecretStoreData> {
  return boxShareOf(await loadOrThrow(), slug);
}

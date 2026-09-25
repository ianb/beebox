/**
 * Machine custody for Cloudflare publishing connections and publication locators.
 * Credentials stay in one locked 0600 machine store and are resolved only by
 * server-side services. Generic secret APIs never see these values, so a
 * generic grant cannot expose an account deployment token to a box agent.
 */

import { appendSecretAccessEvent } from "./access-log.js";
import {
  loadSecretStore,
  mutateSecretStore,
  type CloudflarePublishBindingRecord,
  type CloudflarePublishConnectionRecord,
} from "./store.js";

export const cloudflarePublishConnectionNamePattern = /^[a-z][\da-z-]{0,39}$/;
const accountIdPattern = /^[\da-f]{32}$/i;
const pubIdPattern = /^[2-7a-z]{26}$/;

export interface CloudflarePublishConnectionSummary {
  name: string;
  accountId: string;
  credentialType: "account-api-token" | "user-api-token";
  verifiedAt: string | null;
  tokenId: string | null;
  tokenStatus: "active" | "revoked";
  capabilities: {
    tokenForAccount: "verified" | "unverified";
    r2ObjectWrite: "verified" | "unverified";
    workerDeploy: "verified" | "unverified";
    accessLive: "verified" | "unverified";
  };
  grants: { boxSlug: string; access: "server" }[];
}

export interface CloudflarePublishBinding extends CloudflarePublishBindingRecord {
  pubId: string;
}

export class CloudflarePublishConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflarePublishConnectionError";
  }
}

function connectionError(message: string): CloudflarePublishConnectionError {
  return new CloudflarePublishConnectionError(message);
}

function connectionMap(store: { cloudflarePublishConnections?: Record<string, CloudflarePublishConnectionRecord> | undefined }): Record<string, CloudflarePublishConnectionRecord> {
  return store.cloudflarePublishConnections ?? (store.cloudflarePublishConnections = {});
}

function bindingMap(store: { cloudflarePublishBindings?: Record<string, CloudflarePublishBindingRecord> | undefined }): Record<string, CloudflarePublishBindingRecord> {
  return store.cloudflarePublishBindings ?? (store.cloudflarePublishBindings = {});
}

function summary(name: string, record: CloudflarePublishConnectionRecord): CloudflarePublishConnectionSummary {
  return {
    name,
    accountId: record.accountId,
    credentialType: record.credentialType,
    verifiedAt: record.verifiedAt ?? null,
    tokenId: record.tokenId ?? null,
    tokenStatus: record.apiToken === undefined ? "revoked" : "active",
    capabilities: {
      tokenForAccount: record.capabilities?.tokenForAccountVerifiedAt ? "verified" : "unverified",
      r2ObjectWrite: record.capabilities?.r2ObjectWriteVerifiedAt ? "verified" : "unverified",
      workerDeploy: record.capabilities?.workerDeployVerifiedAt ? "verified" : "unverified",
      accessLive: record.capabilities?.accessLiveVerifiedAt ? "verified" : "unverified",
    },
    grants: Object.keys(record.grants).toSorted().map((boxSlug) => ({ boxSlug, access: "server" as const })),
  };
}

export async function listCloudflarePublishConnections(): Promise<CloudflarePublishConnectionSummary[]> {
  const loaded = await loadSecretStore();
  if (!loaded.ok) throw connectionError(`The machine secret store could not be read: ${loaded.error}`);
  const connections = loaded.value.cloudflarePublishConnections ?? {};
  const summaries: CloudflarePublishConnectionSummary[] = [];
  for (const name of Object.keys(connections).toSorted()) {
    const record = connections[name];
    if (record !== undefined) summaries.push(summary(name, record));
  }
  return summaries;
}

/** Store a previously verified token, preserving grants when rotating in-place. */
export async function saveCloudflarePublishConnection(opts: {
  name: string;
  accountId: string;
  credentialType: "account-api-token" | "user-api-token";
  apiToken: string;
  tokenId: string;
  verifiedAt: string;
}): Promise<CloudflarePublishConnectionSummary> {
  if (!cloudflarePublishConnectionNamePattern.test(opts.name)) {
    throw connectionError("Connection name must start with a letter and contain only lowercase letters, digits, or hyphens (up to 40 characters).");
  }
  if (!accountIdPattern.test(opts.accountId)) throw connectionError("Cloudflare account ID must be 32 hexadecimal characters.");
  if (opts.apiToken.trim() === "") throw connectionError("Cloudflare API token cannot be empty.");
  return mutateSecretStore({ purpose: "cloudflare-publish-connection-save" }, (store) => {
    const connections = connectionMap(store);
    const previous = connections[opts.name];
    if (previous !== undefined && previous.accountId !== opts.accountId) {
      const hasBinding = Object.values(store.cloudflarePublishBindings ?? {}).some((binding) => binding.connectionName === opts.name);
      if (hasBinding) {
        throw connectionError("This connection is pinned to existing publications in its current Cloudflare account. Create a new connection and publication to move accounts.");
      }
    }
    const next: CloudflarePublishConnectionRecord = {
      accountId: opts.accountId,
      credentialType: opts.credentialType,
      apiToken: opts.apiToken,
      tokenId: opts.tokenId,
      verifiedAt: opts.verifiedAt,
      capabilities: { tokenForAccountVerifiedAt: opts.verifiedAt },
      grants: previous?.grants ?? {},
    };
    connections[opts.name] = next;
    return summary(opts.name, next);
  });
}

export async function grantCloudflarePublishConnection(opts: { name: string; boxSlug: string }): Promise<void> {
  await mutateSecretStore({ purpose: "cloudflare-publish-connection-grant" }, (store) => {
    const connection = store.cloudflarePublishConnections?.[opts.name];
    if (connection === undefined) throw connectionError(`No Cloudflare publishing connection named '${opts.name}'.`);
    if (connection.apiToken === undefined) throw connectionError(`Cloudflare publishing connection '${opts.name}' is revoked; rotate it before granting.`);
    connection.grants[opts.boxSlug] = "server";
  });
}

export async function revokeCloudflarePublishGrant(opts: { name: string; boxSlug: string }): Promise<void> {
  await mutateSecretStore({ purpose: "cloudflare-publish-connection-revoke-grant" }, (store) => {
    const connection = store.cloudflarePublishConnections?.[opts.name];
    if (connection === undefined) throw connectionError(`No Cloudflare publishing connection named '${opts.name}'.`);
    delete connection.grants[opts.boxSlug];
  });
}

/** Revoke local custody; the record remains so existing bindings remain locatable. */
export async function revokeCloudflarePublishConnection(name: string, revokedAt: string): Promise<void> {
  await mutateSecretStore({ purpose: "cloudflare-publish-connection-revoke" }, (store) => {
    const connection = store.cloudflarePublishConnections?.[name];
    if (connection === undefined) throw connectionError(`No Cloudflare publishing connection named '${name}'.`);
    delete connection.apiToken;
    delete connection.tokenId;
    connection.revokedAt = revokedAt;
    delete connection.verifiedAt;
    delete connection.capabilities;
  });
}

/** Mark a capability only after a concrete operation has succeeded. */
export async function markCloudflarePublishCapability(opts: {
  name: string;
  capability: "r2ObjectWrite" | "workerDeploy" | "accessLive";
  verifiedAt: string;
}): Promise<void> {
  await mutateSecretStore({ purpose: "cloudflare-publish-capability-verified" }, (store) => {
    const connection = store.cloudflarePublishConnections?.[opts.name];
    if (connection === undefined || connection.apiToken === undefined) {
      throw connectionError(`Cloudflare publishing connection '${opts.name}' is missing or revoked.`);
    }
    const capabilities = connection.capabilities ??= {
      tokenForAccountVerifiedAt: connection.verifiedAt ?? opts.verifiedAt,
    };
    if (opts.capability === "r2ObjectWrite") capabilities.r2ObjectWriteVerifiedAt = opts.verifiedAt;
    else if (opts.capability === "workerDeploy") capabilities.workerDeployVerifiedAt = opts.verifiedAt;
    else capabilities.accessLiveVerifiedAt = opts.verifiedAt;
  });
}

/** Resolve a credential only for a server grant. It never returns through tRPC. */
export async function resolveCloudflarePublishCredential(opts: {
  name: string;
  boxSlug: string;
  purpose: "publish-prepare" | "publish-enable" | "publish-disable";
  at: string;
}): Promise<{ accountId: string; apiToken: string }> {
  const loaded = await loadSecretStore();
  if (!loaded.ok) throw connectionError(`The machine secret store could not be read: ${loaded.error}`);
  const connection = loaded.value.cloudflarePublishConnections?.[opts.name];
  if (connection === undefined) throw connectionError(`No Cloudflare publishing connection named '${opts.name}'.`);
  if (connection.grants[opts.boxSlug] !== "server") throw connectionError(`Cloudflare publishing connection '${opts.name}' has no server grant for box '${opts.boxSlug}'.`);
  if (connection.apiToken === undefined) throw connectionError(`Cloudflare publishing connection '${opts.name}' is revoked; server operations are unavailable.`);
  await appendSecretAccessEvent({ ts: opts.at, box: opts.boxSlug, secret: `cloudflare-publish/${opts.name}`, purpose: opts.purpose, event: "resolve" });
  return { accountId: connection.accountId, apiToken: connection.apiToken };
}

export async function getCloudflarePublishBinding(opts: { pubId: string; boxSlug: string }): Promise<CloudflarePublishBinding | null> {
  if (!pubIdPattern.test(opts.pubId)) throw connectionError("Invalid publication id.");
  const loaded = await loadSecretStore();
  if (!loaded.ok) throw connectionError(`The machine secret store could not be read: ${loaded.error}`);
  const binding = loaded.value.cloudflarePublishBindings?.[opts.pubId];
  if (binding === undefined) return null;
  if (binding.boxSlug !== opts.boxSlug) throw connectionError("This publication id is already bound to a different box.");
  return { pubId: opts.pubId, ...binding };
}

/** Reserve a globally unique PubId and pin its immutable Cloudflare locator. */
export async function reserveCloudflarePublishBinding(opts: {
  pubId: string;
  boxSlug: string;
  connectionName: string;
  bucketName: string;
  workerName: string;
  hostHandle: string;
  createdAt: string;
}): Promise<CloudflarePublishBinding> {
  if (!pubIdPattern.test(opts.pubId)) throw connectionError("Invalid publication id.");
  return mutateSecretStore({ purpose: "cloudflare-publish-binding-reserve" }, (store) => {
    const bindings = bindingMap(store);
    const existing = bindings[opts.pubId];
    if (existing !== undefined) {
      if (existing.boxSlug !== opts.boxSlug) throw connectionError("This publication id is already bound to a different box.");
      if (existing.connectionName !== opts.connectionName) throw connectionError("This publication is pinned to its existing Cloudflare connection. Create a new publication to move it to another connection.");
      return { pubId: opts.pubId, ...existing };
    }
    const connection = store.cloudflarePublishConnections?.[opts.connectionName];
    if (connection === undefined || connection.apiToken === undefined) throw connectionError(`Cloudflare publishing connection '${opts.connectionName}' is missing or revoked.`);
    if (connection.grants[opts.boxSlug] !== "server") throw connectionError(`Cloudflare publishing connection '${opts.connectionName}' has no server grant for box '${opts.boxSlug}'.`);
    const boxBucket = Object.values(bindings).find((binding) => binding.boxSlug === opts.boxSlug && binding.connectionName === opts.connectionName)?.bucketName;
    const binding: CloudflarePublishBindingRecord = {
      boxSlug: opts.boxSlug,
      connectionName: opts.connectionName,
      accountId: connection.accountId,
      bucketName: boxBucket ?? opts.bucketName,
      workerName: opts.workerName,
      hostHandle: opts.hostHandle,
      createdAt: opts.createdAt,
    };
    bindings[opts.pubId] = binding;
    return { pubId: opts.pubId, ...binding };
  });
}

export async function listCloudflarePublishBindings(boxSlug: string): Promise<CloudflarePublishBinding[]> {
  const loaded = await loadSecretStore();
  if (!loaded.ok) throw connectionError(`The machine secret store could not be read: ${loaded.error}`);
  return Object.entries(loaded.value.cloudflarePublishBindings ?? {})
    .filter(([, binding]) => binding.boxSlug === boxSlug)
    .map(([pubId, binding]) => ({ pubId, ...binding }))
    .toSorted((a, b) => a.pubId.localeCompare(b.pubId));
}

/** Used by legacy CLI paths to refuse mutation of server-managed publications. */
export async function isServerManagedPublication(pubId: string): Promise<boolean> {
  const loaded = await loadSecretStore();
  if (!loaded.ok) throw connectionError(`The machine secret store could not be read: ${loaded.error}`);
  return loaded.value.cloudflarePublishBindings?.[pubId] !== undefined;
}

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { secretsLogDir } from "../core/secrets/store.js";
import { withFileLock } from "../lib/file-lock.js";
import { staticBearer } from "../services/cloudflare-bearer.js";
import { defaultManagedPublicationRuntime, type ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import type { CloudflareZone, WorkerDomain } from "../services/cloudflare-provisioning.js";
import { publicationError, readCandidate, readSiteManifest, stable, storeFor } from "./managed-publications.js";

const hostnamePattern = /^(?=.{1,253}$)(?:[\da-z](?:[\da-z-]{0,61}[\da-z])?\.)+[a-z](?:[\da-z-]{0,61}[\da-z])?$/;

export function normalizePublicationHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (!hostnamePattern.test(hostname) || isIP(hostname) !== 0) {
    throw publicationError("Enter a complete DNS hostname such as www.example.com, without a scheme, path, port, or wildcard.");
  }
  return hostname;
}

function sameWorkerDomain(domain: WorkerDomain, expected: { hostname: string; service: string; zoneId: string; zoneName: string }): boolean {
  return domain.hostname.toLowerCase() === expected.hostname
    && domain.service === expected.service
    && domain.environment === "production"
    && domain.zoneId === expected.zoneId
    && domain.zoneName.toLowerCase() === expected.zoneName;
}

function matchingZone(args: { hostname: string; accountId: string; zones: CloudflareZone[] }) {
  const { hostname, accountId, zones } = args;
  return zones
    .filter((zone) => zone.accountId === accountId && zone.status === "active" && (hostname === zone.name.toLowerCase() || hostname.endsWith(`.${zone.name.toLowerCase()}`)))
    .toSorted((a, b) => b.name.length - a.name.length)[0];
}

type PublicationBinding = NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBinding"]>>>;

async function loadAssignablePublication(input: { args: { boxRoot: string; boxSlug: string; pubId: string; hostname: string }; runtime: ManagedPublicationRuntime; binding: PublicationBinding }) {
  const { args, runtime, binding } = input;
  const currentBinding = await runtime.getBinding({ pubId: args.pubId, boxSlug: args.boxSlug });
  if (currentBinding === null || currentBinding.hostHandle !== binding.hostHandle || currentBinding.workerName !== binding.workerName) {
    throw publicationError("The publication binding changed while assigning its hostname. Refresh and try again.");
  }
  const { credential, store } = await storeFor({ binding: currentBinding, boxRoot: args.boxRoot, runtime, purpose: "publish-enable" });
  const [manifest, candidate] = await Promise.all([readSiteManifest(store, args.pubId), readCandidate(store, args.pubId)]);
  if (manifest === null || manifest.status !== "disabled") throw publicationError("Disable the publication before assigning its hostname.");
  if (candidate === null || candidate.pubId !== currentBinding.pubId || candidate.requestedScope.hostHandle !== currentBinding.hostHandle) {
    throw publicationError("Prepare this publication before assigning its hostname.");
  }
  if (candidate.requestedScope.tier !== "public" && candidate.requestedScope.tier !== "secret") {
    throw publicationError("Custom hostnames are supported only for public or secret publications.");
  }
  if (manifest.tier !== candidate.requestedScope.tier || manifest.hostHandle !== currentBinding.hostHandle) {
    throw publicationError("The prepared candidate and disabled publication do not match. Prepare the current publication first.");
  }
  if (candidate.requestedScope.customHostname !== undefined && candidate.requestedScope.customHostname !== args.hostname) {
    throw publicationError("The prepared candidate already requests a different hostname. Refresh it before continuing.");
  }
  return { currentBinding, credential, store, candidate };
}

async function preflightDomain(input: { hostname: string; accountId: string; binding: PublicationBinding; provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>; workerVersion: string }) {
  const { hostname, accountId, binding, provisioning, workerVersion } = input;
  const zone = matchingZone({ hostname, accountId, zones: await provisioning.listZones() });
  if (zone === undefined) throw publicationError("No active Cloudflare zone in this connection owns that hostname.");
  const expected = { hostname, service: binding.workerName, zoneId: zone.id, zoneName: zone.name };
  const domains = await provisioning.listWorkerDomains(hostname);
  const matching = domains.find((domain) => domain.hostname.toLowerCase() === hostname);
  if (domains.some((domain) => domain.hostname.toLowerCase() === hostname && !sameWorkerDomain(domain, expected))) {
    throw publicationError("Cloudflare already routes this hostname to another Worker or zone. Bee Box will not replace that route.");
  }
  const settings = await provisioning.getScriptSettings(binding.workerName);
  const configured = new Map((settings?.bindings ?? []).map((item) => [item.name, item]));
  if (configured.get("PUB_ID")?.text !== binding.pubId || configured.get("HOST_HANDLE")?.text !== binding.hostHandle
    || configured.get("PUB_STORE")?.bucketName !== binding.bucketName) {
    throw publicationError("The deployed Worker does not match this publication's server-owned identity; prepare and deploy it again first.");
  }
  if (configured.get("PUB_WORKER_VERSION")?.text !== workerVersion) {
    throw publicationError("The deployed Worker is an older version that cannot serve custom-hostname manifests. Re-prepare this publication to update its Worker, then assign the hostname again.");
  }
  return { expected, matching };
}

async function attachAndReadBack(input: { expected: { hostname: string; service: string; zoneId: string; zoneName: string }; provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]> }) {
  await input.provisioning.attachWorkerDomain(input.expected);
  return (await input.provisioning.listWorkerDomains(input.expected.hostname)).find((domain) => domain.hostname.toLowerCase() === input.expected.hostname);
}

async function assignWithinPublicationLock(input: { args: { boxRoot: string; boxSlug: string; pubId: string; hostname: string }; runtime: ManagedPublicationRuntime; binding: PublicationBinding }) {
  const { args, runtime } = input;
  const { currentBinding, credential, store, candidate } = await loadAssignablePublication(input);
  const bearer = staticBearer(credential.apiToken);
  const provisioning = runtime.createProvisioning({ accountId: credential.accountId, bearer });
  const workerVersion = createHash("sha256").update(await runtime.workerBundle()).digest("hex");
  const { expected, matching: existingDomain } = await preflightDomain({ hostname: args.hostname, accountId: credential.accountId, binding: currentBinding, provisioning, workerVersion });
  await runtime.reserveHostname({ pubId: args.pubId, boxSlug: args.boxSlug, hostname: args.hostname });
  const { revision: _oldRevision, ...oldBody } = candidate;
  const body = { ...oldBody, requestedScope: { ...candidate.requestedScope, customHostname: args.hostname } };
  const next = { ...body, revision: createHash("sha256").update(stable(body)).digest("hex") };
  await store.put(`pubs/${args.pubId}/pending.json`, { body: JSON.stringify(next) });
  const confirmed = await readCandidate(store, args.pubId);
  if (confirmed === null || confirmed.revision !== next.revision) throw publicationError("Cloudflare R2 did not confirm the hostname in the pending publication candidate.");

  const verifiedDomain = existingDomain ?? await attachAndReadBack({ expected, provisioning });
  if (verifiedDomain === undefined || !sameWorkerDomain(verifiedDomain, expected)) {
    throw publicationError("Cloudflare did not confirm the exact Worker-domain assignment. The publication remains disabled; retry this hostname assignment after checking Cloudflare.");
  }
  await runtime.assignHostname({ pubId: args.pubId, boxSlug: args.boxSlug, hostname: args.hostname });
}

/** Attach one owner-selected hostname to a prepared disabled publication. */
export async function assignManagedPublicationHostname(args: {
  boxRoot: string;
  boxSlug: string;
  pubId: string;
  hostname: string;
}, injectedRuntime?: ManagedPublicationRuntime): Promise<{ hostname: string }> {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  const hostname = normalizePublicationHostname(args.hostname);
  const hostLockDir = path.join(secretsLogDir(), "publication-host-locks");
  await mkdir(hostLockDir, { recursive: true });

  // Lock order is always hostname, then publication. It serializes Bee Box
  // writers; Cloudflare itself offers no conditional attach/CAS operation.
  const hostLock = path.join(hostLockDir, `${createHash("sha256").update(hostname).digest("hex")}.lock`);
  await withFileLock({ lockPath: hostLock, metadata: { purpose: "managed-publication-hostname", hostname }, waitMs: 10_000 }, async () => {
    const binding = await runtime.getBinding({ pubId: args.pubId, boxSlug: args.boxSlug });
    if (binding === null) throw publicationError("Publication is not registered on this server.");
    if (binding.customHostname !== undefined && binding.customHostname !== hostname) {
      throw publicationError("This publication already has a different custom hostname. Bee Box cannot remap or release a hostname reservation, even after a Cloudflare detach. Use a different hostname.");
    }
    const owner = await runtime.findHostnameOwner(hostname);
    if (owner !== null && owner.pubId !== args.pubId) throw publicationError("This hostname is already assigned to another Bee Box publication.");

    const pubLockDir = path.join(args.boxRoot, ".beebox", "publish-locks");
    await mkdir(pubLockDir, { recursive: true });
    await withFileLock({ lockPath: path.join(pubLockDir, `${args.pubId}.lock`), metadata: { purpose: "managed-publication-hostname-assign", pubId: args.pubId }, waitMs: 10_000 }, async () => {
      // Lock order is host, then publication, matching preparation/actions.
      await assignWithinPublicationLock({ args: { ...args, hostname }, runtime, binding });
    });
  });
  return { hostname };
}

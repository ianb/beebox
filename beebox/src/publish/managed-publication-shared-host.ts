import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { secretsLogDir } from "../core/secrets/store.js";
import { withFileLock } from "../lib/file-lock.js";
import { staticBearer } from "../services/cloudflare-bearer.js";
import type { CloudflareZone, WorkerDomain } from "../services/cloudflare-provisioning/core.js";
import type { DeployedBinding } from "../services/cloudflare-provisioning/core.js";
import { defaultManagedPublicationRuntime, type ManagedPublicationRuntime } from "../services/managed-publication-runtime/core.js";
import { publicationError } from "./managed-publications/core.js";

const hostnamePattern = /^(?=.{1,253}$)(?:[\da-z](?:[\da-z-]{0,61}[\da-z])?\.)+[a-z](?:[\da-z-]{0,61}[\da-z])?$/;

export function normalizeSharedPublicationHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (!hostnamePattern.test(hostname) || isIP(hostname) !== 0) {
    throw publicationError("Enter a complete DNS hostname such as sites.example.com, without a scheme, path, port, or wildcard.");
  }
  return hostname;
}

function sameDomain(domain: WorkerDomain, expected: { hostname: string; service: string; zoneId: string; zoneName: string }): boolean {
  return domain.hostname.toLowerCase() === expected.hostname
    && domain.service === expected.service
    && domain.environment === "production"
    && domain.zoneId === expected.zoneId
    && domain.zoneName.toLowerCase() === expected.zoneName;
}

function matchingZone(args: { hostname: string; accountId: string; zones: CloudflareZone[] }): CloudflareZone | undefined {
  return args.zones
    .filter((zone) => zone.accountId === args.accountId && zone.status === "active" && (args.hostname === zone.name.toLowerCase() || args.hostname.endsWith(`.${zone.name.toLowerCase()}`)))
    .toSorted((a, b) => b.name.length - a.name.length)[0];
}

async function ensureSharedWorker(args: {
  mapping: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>;
  runtime: ManagedPublicationRuntime;
  credential: { accountId: string; apiToken: string };
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  boxRoot: string;
}): Promise<string> {
  const { mapping, runtime, credential, provisioning, boxRoot } = args;
  const bundle = await runtime.workerBundle();
  const workerVersion = createHash("sha256").update(bundle).digest("hex");
  const settings = await provisioning.getScriptSettings(mapping.workerName);
  const bindings = new Map((settings?.bindings ?? []).map((binding) => [binding.name, binding]));
  if (settings !== null && !sharedWorkerIdentityMatches(bindings, mapping)) throw publicationError("The existing Worker name belongs to a different publication destination. Bee Box will not replace it.");
  if (settings === null || bindings.get("PUB_WORKER_VERSION")?.text !== workerVersion) await deploySharedWorker({ mapping, runtime, credential, provisioning, bundle, workerVersion });
  await disableWorkerAliases({ mapping, provisioning });
  await runtime.markCapability({ name: mapping.connectionName, capability: "workerDeploy", verifiedAt: runtime.now(boxRoot).toISOString() });
  return workerVersion;
}

function sharedWorkerIdentityMatches(bindings: Map<string, DeployedBinding>, mapping: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>): boolean {
  return bindings.get("PUB_WORKER_MODE")?.text === "shared-v1"
    && bindings.get("PUB_BOX_HANDLE")?.text === mapping.hostHandle
    && bindings.get("PUB_HOSTNAME")?.text === mapping.hostname
    && bindings.get("PUB_STORE")?.bucketName === mapping.bucketName;
}

async function deploySharedWorker(args: {
  mapping: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>;
  runtime: ManagedPublicationRuntime;
  credential: { accountId: string; apiToken: string };
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  bundle: Uint8Array;
  workerVersion: string;
}): Promise<void> {
  await args.runtime.createWorkerDeployer({ accountId: args.credential.accountId, bearer: staticBearer(args.credential.apiToken) }).deploy({ mode: "shared", scriptName: args.mapping.workerName, bucketName: args.mapping.bucketName, hostHandle: args.mapping.hostHandle, hostname: args.mapping.hostname, workerVersion: args.workerVersion, bundle: args.bundle });
  const confirmed = await args.provisioning.getScriptSettings(args.mapping.workerName);
  const bindings = new Map((confirmed?.bindings ?? []).map((binding) => [binding.name, binding]));
  if (!sharedWorkerIdentityMatches(bindings, args.mapping) || bindings.get("PUB_WORKER_VERSION")?.text !== args.workerVersion) {
    throw publicationError("Cloudflare did not confirm the shared Worker's version, host, and bucket bindings.");
  }
}

async function disableWorkerAliases(args: { mapping: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>; provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]> }): Promise<void> {
  const settings = await args.provisioning.getScriptSubdomain(args.mapping.workerName);
  if (settings !== null && !settings.enabled && !settings.previewsEnabled) return;
  await args.provisioning.setScriptSubdomain(args.mapping.workerName, { enabled: false, previewsEnabled: false });
  const confirmed = await args.provisioning.getScriptSubdomain(args.mapping.workerName);
  if (confirmed === null || confirmed.enabled || confirmed.previewsEnabled) throw publicationError("Cloudflare did not confirm that the shared Worker's workers.dev and preview routes are disabled.");
}

async function ensureDomain(args: {
  mapping: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>;
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  allowAttach: boolean;
}): Promise<void> {
  const { mapping, provisioning } = args;
  const zone = matchingZone({ hostname: mapping.hostname, accountId: mapping.accountId, zones: await provisioning.listZones() });
  if (zone === undefined) throw publicationError("No active Cloudflare zone in this connection owns that hostname.");
  const expected = { hostname: mapping.hostname, service: mapping.workerName, zoneId: zone.id, zoneName: zone.name };
  const domains = await provisioning.listWorkerDomains(mapping.hostname);
  const found = domains.find((domain) => domain.hostname.toLowerCase() === mapping.hostname);
  if (found !== undefined && !sameDomain(found, expected)) {
    throw publicationError("Cloudflare already routes this hostname to another Worker or zone. Bee Box will not replace that route.");
  }
  if (found !== undefined) return;
  if (!args.allowAttach) throw publicationError("The saved shared hostname is no longer attached to its Worker. Bee Box will not reattach it automatically.");
  await provisioning.attachWorkerDomain(expected);
  const attached = (await provisioning.listWorkerDomains(mapping.hostname)).find((domain) => domain.hostname.toLowerCase() === mapping.hostname);
  if (attached === undefined || !sameDomain(attached, expected)) throw publicationError("Cloudflare did not confirm the exact shared hostname attachment. Retry shared-host setup to continue.");
}

/** Configure and attach the one shared publication hostname for this box. */
export async function configureManagedPublicationSharedHost(args: {
  boxRoot: string;
  boxSlug: string;
  connectionName: string;
  hostname: string;
}, injectedRuntime?: ManagedPublicationRuntime): Promise<{ hostname: string; connectionName: string; status: "pending" | "attached" }> {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  const hostname = normalizeSharedPublicationHostname(args.hostname);
  const hostLockDir = path.join(secretsLogDir(), "publication-host-locks");
  await mkdir(hostLockDir, { recursive: true });
  const hostLock = path.join(hostLockDir, `${createHash("sha256").update(hostname).digest("hex")}.lock`);
  return withFileLock({ lockPath: hostLock, metadata: { purpose: "managed-publication-shared-host", hostname }, waitMs: 10_000 }, async () => {
    const existing = await runtime.getBoxHost(args.boxSlug);
    const existingBucket = (await runtime.listBindings(args.boxSlug)).find((binding) => binding.connectionName === args.connectionName)?.bucketName;
    const hostHandle = existing?.hostHandle ?? runtime.newHostHandle();
    const mapping = await runtime.reserveBoxHost({
      boxSlug: args.boxSlug,
      connectionName: args.connectionName,
      hostname,
      bucketName: existing?.bucketName ?? existingBucket ?? runtime.newBucketName(),
      workerName: existing?.workerName ?? hostHandle,
      hostHandle,
      createdAt: runtime.now(args.boxRoot).toISOString(),
    });
    const credential = await runtime.resolveCredential({ name: mapping.connectionName, boxSlug: args.boxSlug, purpose: "publish-prepare", at: runtime.now(args.boxRoot).toISOString() });
    if (credential.accountId !== mapping.accountId) throw publicationError("The selected Cloudflare connection changed accounts after this host was reserved.");
    const provisioning = runtime.createProvisioning({ accountId: credential.accountId, bearer: staticBearer(credential.apiToken) });
    const bucketResult = await provisioning.createBucket(mapping.bucketName);
    if (bucketResult.created) await runtime.markCapability({ name: mapping.connectionName, capability: "r2ObjectWrite", verifiedAt: runtime.now(args.boxRoot).toISOString() });
    const workerVersion = await ensureSharedWorker({ mapping, runtime, credential, provisioning, boxRoot: args.boxRoot });
    const current = await runtime.getBoxHost(args.boxSlug);
    if (current === null || current.hostname !== mapping.hostname || current.hostHandle !== mapping.hostHandle) throw publicationError("The box's shared hostname mapping changed during setup.");
    await ensureDomain({ mapping, provisioning, allowAttach: mapping.status === "pending" });
    const attached = await provisioning.getScriptSettings(mapping.workerName);
    if (attached === null || !attached.bindings.some((binding) => binding.name === "PUB_WORKER_VERSION" && binding.text === workerVersion)) {
      throw publicationError("Cloudflare no longer confirms the deployed shared Worker. Retry shared-host setup.");
    }
    const ready = mapping.status === "attached"
      ? mapping
      : await runtime.attachBoxHost({ boxSlug: args.boxSlug, connectionName: args.connectionName, hostname });
    return { hostname: ready.hostname, connectionName: ready.connectionName, status: ready.status };
  });
}

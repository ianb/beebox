import { createHash } from "node:crypto";

import { staticBearer } from "../../services/cloudflare-bearer.js";
import type { DeployedBinding } from "../../services/cloudflare-provisioning/core.js";
import type { ManagedPublicationRuntime } from "../../services/managed-publication-runtime/core.js";

/** Deploy a pinned legacy Worker or validate the box's already-attached shared Worker. */
export async function ensureWorkerDeployment(args: {
  runtime: ManagedPublicationRuntime;
  boxRoot: string;
  credential: { accountId: string; apiToken: string };
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  pubId: string;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
  connectionName: string;
  fail(message: string): Error;
}): Promise<void> {
  const bundle = await args.runtime.workerBundle();
  const workerVersion = createHash("sha256").update(bundle).digest("hex");
  const boxHost = await args.runtime.getBoxHost(args.reserved.boxSlug);
  if (isSharedBinding(boxHost, args)) {
    await assertSharedWorker({ boxHost, provisioning: args.provisioning, workerVersion, fail: args.fail });
    return;
  }
  await ensurePinnedWorker({ ...args, bundle, workerVersion });
}

function isSharedBinding(boxHost: Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>, args: {
  connectionName: string;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
}): boxHost is NonNullable<typeof boxHost> {
  return boxHost !== null && boxHost.status === "attached"
    && boxHost.connectionName === args.connectionName
    && boxHost.workerName === args.reserved.workerName
    && boxHost.hostHandle === args.reserved.hostHandle
    && boxHost.bucketName === args.reserved.bucketName;
}

async function assertSharedWorker(args: {
  boxHost: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>;
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  workerVersion: string;
  fail(message: string): Error;
}): Promise<void> {
  const settings = await args.provisioning.getScriptSettings(args.boxHost.workerName);
  const bindings = new Map((settings?.bindings ?? []).map((binding) => [binding.name, binding]));
  if (!sharedBindingsMatch({ bindings, host: args.boxHost, workerVersion: args.workerVersion })) {
    throw args.fail("The shared publication Worker is stale or no longer matches this box. Ask Admin to retry shared-host setup before preparing content.");
  }
}

function sharedBindingsMatch(args: { bindings: Map<string, DeployedBinding>; host: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>>; workerVersion: string }): boolean {
  const { bindings, host, workerVersion } = args;
  return bindings.get("PUB_WORKER_MODE")?.text === "shared-v1"
    && bindings.get("PUB_BOX_HANDLE")?.text === host.hostHandle
    && bindings.get("PUB_HOSTNAME")?.text === host.hostname
    && bindings.get("PUB_STORE")?.bucketName === host.bucketName
    && bindings.get("PUB_WORKER_VERSION")?.text === workerVersion;
}

async function ensurePinnedWorker(args: {
  runtime: ManagedPublicationRuntime;
  boxRoot: string;
  credential: { accountId: string; apiToken: string };
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  pubId: string;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
  connectionName: string;
  bundle: Uint8Array;
  workerVersion: string;
  fail(message: string): Error;
}): Promise<void> {
  const settings = await args.provisioning.getScriptSettings(args.reserved.workerName);
  const bindings = new Map((settings?.bindings ?? []).map((binding) => [binding.name, binding]));
  if (settings !== null && !pinnedIdentityMatches(bindings, args)) {
    throw args.fail("The existing Cloudflare Worker name is bound to a different publication or bucket; refusing to replace it.");
  }
  if (settings === null || bindings.get("PUB_WORKER_VERSION")?.text !== args.workerVersion) {
    const deployer = args.runtime.createWorkerDeployer({ accountId: args.credential.accountId, bearer: staticBearer(args.credential.apiToken) });
    await deployer.deploy({ mode: "pinned", scriptName: args.reserved.workerName, bucketName: args.reserved.bucketName, pubId: args.pubId, hostHandle: args.reserved.hostHandle, workerVersion: args.workerVersion, bundle: args.bundle });
    await verifyPinnedWorker(args);
  }
  await args.runtime.markCapability({ name: args.connectionName, capability: "workerDeploy", verifiedAt: args.runtime.now(args.boxRoot).toISOString() });
  await enablePinnedAlias(args);
}

function pinnedIdentityMatches(bindings: Map<string, DeployedBinding>, args: {
  pubId: string;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
}): boolean {
  return bindings.get("PUB_ID")?.text === args.pubId
    && bindings.get("HOST_HANDLE")?.text === args.reserved.hostHandle
    && bindings.get("PUB_STORE")?.bucketName === args.reserved.bucketName;
}

async function verifyPinnedWorker(args: {
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  pubId: string;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
  workerVersion: string;
  fail(message: string): Error;
}): Promise<void> {
  const settings = await args.provisioning.getScriptSettings(args.reserved.workerName);
  const bindings = new Map((settings?.bindings ?? []).map((binding) => [binding.name, binding]));
  if (!pinnedIdentityMatches(bindings, args) || bindings.get("PUB_WORKER_VERSION")?.text !== args.workerVersion) {
    throw args.fail("Cloudflare did not confirm the deployed Worker identity and binding settings.");
  }
}

async function enablePinnedAlias(args: {
  provisioning: ReturnType<ManagedPublicationRuntime["createProvisioning"]>;
  reserved: Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>;
}): Promise<void> {
  const subdomain = await args.provisioning.getScriptSubdomain(args.reserved.workerName);
  if (subdomain === null || !subdomain.enabled || subdomain.previewsEnabled) {
    await args.provisioning.setScriptSubdomain(args.reserved.workerName, { enabled: true, previewsEnabled: false });
  }
}

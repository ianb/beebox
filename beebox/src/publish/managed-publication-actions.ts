import { mkdir } from "node:fs/promises";
import path from "node:path";

import { sharedMarkerMatchesScope, sharedRouteMarkerKey, siteEdgeManifestSchema, type SharedRouteMarker, type SiteEdgeManifest } from "./manifest-edge.js";
import { defaultManagedPublicationRuntime, type ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import { withFileLock } from "../lib/file-lock.js";
import { slugKey } from "./lifecycle.js";
import { publicationError, readCandidate, readSharedRouteMarker, readSiteManifest, sharedPublicPath, stable, storeFor } from "./managed-publications.js";

async function manifestForApproval(input: { args: { pubId: string; expectedRevision?: string }; binding: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBinding"]>>>; store: Awaited<ReturnType<typeof storeFor>>["store"]; runtime: ManagedPublicationRuntime; boxSlug: string }): Promise<{ manifest: SiteEdgeManifest; sharedHost?: { hostname: string; hostHandle: string; path: string } }> {
  const { args, binding, store, runtime, boxSlug } = input;
  const candidate = await readCandidate(store, args.pubId);
  if (candidate === null || candidate.revision !== args.expectedRevision) throw publicationError("The publication candidate changed. Review the latest candidate before approving it.");
  if (candidate.pubId !== binding.pubId || candidate.requestedScope.hostHandle !== binding.hostHandle) throw publicationError("The pending candidate does not match this server-owned publication binding.");
  const requestedHostname = "customHostname" in candidate.requestedScope ? candidate.requestedScope.customHostname : undefined;
  if ((requestedHostname ?? null) !== (binding.customHostname ?? null)) throw publicationError("The candidate hostname changed. Prepare the publication again before approving it.");
  if (binding.customHostname !== undefined && binding.customHostnameStatus !== "attached") throw publicationError("Cloudflare has not confirmed this hostname yet. Retry the hostname assignment before approving the publication.");
  if (candidate.requestedScope.tier === "accounts" || candidate.requestedScope.tier === "any-account") {
    throw publicationError("Account-restricted publication cannot be enabled until Cloudflare Access setup has been verified for this Worker host.");
  }
  const { sharedHost, ...manifestScope } = candidate.requestedScope;
  if (sharedHost !== undefined) {
    const mapping = await runtime.getBoxHost(boxSlug);
    if (mapping === null || mapping.status !== "attached" || mapping.hostname !== sharedHost.hostname || mapping.hostHandle !== sharedHost.hostHandle || mapping.connectionName !== binding.connectionName) {
      throw publicationError("The box's shared hostname changed or is not attached. Retry Admin shared-host setup and prepare the publication again.");
    }
    if (candidate.requestedScope.tier === "public") sharedPublicPath(candidate.requestedScope.slug);
  }
  const requested = siteEdgeManifestSchema.safeParse({
    ...manifestScope,
    status: "live",
    activeRelease: { id: candidate.releaseId, files: candidate.files },
  });
  if (!requested.success) throw publicationError("The pending publication scope or release is invalid.");
  return { manifest: requested.data, ...(sharedHost === undefined ? {} : { sharedHost }) };
}

function manifestForStatus(input: { action: "enable" | "disable" | "revoke"; manifest: SiteEdgeManifest; binding: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBinding"]>>> }): SiteEdgeManifest {
  const { action, manifest, binding } = input;
  if (action === "enable" && (manifest.tier === "accounts" || manifest.tier === "any-account")) {
    throw publicationError("Account-restricted publication cannot be enabled until Cloudflare Access setup has been verified for this Worker host.");
  }
  if (action === "enable" && (manifest.customHostname ?? null) !== (binding.customHostname ?? null)) {
    throw publicationError("The approved publication hostname does not match its server-owned hostname assignment. Approve the current candidate first.");
  }
  if (action === "enable" && binding.customHostname !== undefined && binding.customHostnameStatus !== "attached") {
    throw publicationError("Cloudflare has not confirmed this hostname yet. Retry the hostname assignment before enabling the publication.");
  }
  const status = action === "disable" ? "disabled" : action === "revoke" ? "revoked" : "live";
  return siteEdgeManifestSchema.parse({ ...manifest, status });
}

async function mutateManifest(args: { boxRoot: string; boxSlug: string; pubId: string; action: "approve" | "enable" | "disable" | "revoke"; expectedRevision?: string }, runtime: ManagedPublicationRuntime): Promise<void> {
  const lockDir = path.join(args.boxRoot, ".beebox", "publish-locks");
  await mkdir(lockDir, { recursive: true });
  await withFileLock({ lockPath: path.join(lockDir, "shared-routing.lock"), metadata: { purpose: `managed-publication-${args.action}-routing`, boxSlug: args.boxSlug }, waitMs: 10_000 }, async () => {
    await mutateOnePublication({ args, runtime, lockDir });
  });
}

async function mutateOnePublication(args: { args: { boxRoot: string; boxSlug: string; pubId: string; action: "approve" | "enable" | "disable" | "revoke"; expectedRevision?: string }; runtime: ManagedPublicationRuntime; lockDir: string }): Promise<void> {
  const { args: input, runtime, lockDir } = args;
  await withFileLock({ lockPath: path.join(lockDir, `${input.pubId}.lock`), metadata: { purpose: `managed-publication-${input.action}`, pubId: input.pubId }, waitMs: 10_000 }, async () => {
    const binding = await runtime.getBinding({ pubId: input.pubId, boxSlug: input.boxSlug });
    if (binding === null) throw publicationError("Publication is not registered on this server.");
    const purpose = input.action === "disable" || input.action === "revoke" ? "publish-disable" : "publish-enable";
    const { store } = await storeFor({ binding, boxRoot: input.boxRoot, runtime, purpose });
    const manifest = await readSiteManifest(store, input.pubId);
    if (manifest === null) throw publicationError("Publication edge state is missing.");
    if (manifest.status === "revoked") throw publicationError("This publication is revoked and cannot be changed.");
    const approved = input.action === "approve" ? await manifestForApproval({ args: input, binding, store, runtime, boxSlug: input.boxSlug }) : null;
    const next = approved?.manifest ?? manifestForStatus({ action: input.action === "approve" ? "enable" : input.action, manifest, binding });
    const route = await authorizeSharedRoute({ action: input.action, sharedHost: approved?.sharedHost, next, binding, runtime, boxSlug: input.boxSlug, store, pubId: input.pubId });
    await writeManifest({ store, pubId: input.pubId, next });
    if (input.action === "approve" && route !== null) await persistApprovedSharedRoute({ store, pubId: input.pubId, route });
  });
}

async function authorizeSharedRoute(args: { action: "approve" | "enable" | "disable" | "revoke"; sharedHost: { hostname: string; hostHandle: string; path: string } | undefined; next: SiteEdgeManifest; binding: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBinding"]>>>; runtime: ManagedPublicationRuntime; boxSlug: string; store: Awaited<ReturnType<typeof storeFor>>["store"]; pubId: string }): Promise<{ marker: SharedRouteMarker; publicSlug?: string } | null> {
  if (args.action !== "approve" && args.action !== "enable") return null;
  if (args.action === "approve" && args.sharedHost === undefined) return null;
  const mapping = await args.runtime.getBoxHost(args.boxSlug);
  if (mapping === null || mapping.status !== "attached" || mapping.connectionName !== args.binding.connectionName) {
    if (args.action === "enable" && args.sharedHost === undefined && await readSharedRouteMarker(args.store, args.pubId) === null) return null;
    throw publicationError("The shared publication route no longer matches the attached box hostname.");
  }
  if (args.action === "approve") {
    if (args.sharedHost === undefined || mapping.hostname !== args.sharedHost.hostname || mapping.hostHandle !== args.sharedHost.hostHandle) throw publicationError("The shared publication route no longer matches the attached box hostname.");
    if (args.next.tier === "public" && args.sharedHost.path !== sharedPublicPath(args.next.slug)) throw publicationError("The shared public path does not match the approved slug.");
    const expected: SharedRouteMarker = { schemaVersion: 1, pubId: args.pubId, boxHostHandle: args.sharedHost.hostHandle, hostname: args.sharedHost.hostname, path: args.sharedHost.path, manifestHostHandle: args.next.hostHandle };
    return { marker: expected, ...(await publicSlugForApproval({ store: args.store, manifest: args.next, pubId: args.pubId })) };
  }
  const marker = await readSharedRouteMarker(args.store, args.pubId);
  const usesSharedWorker = args.binding.workerName === mapping.workerName && args.binding.hostHandle === mapping.hostHandle && args.binding.bucketName === mapping.bucketName;
  if (marker === null) return missingSharedMarker(usesSharedWorker);
  const pathForManifest = args.next.tier === "public" ? sharedPublicPath(args.next.slug)
    : args.next.tier === "secret" ? `/s/${args.pubId}/` : null;
  const expected: SharedRouteMarker = { schemaVersion: 1, pubId: args.pubId, boxHostHandle: mapping.hostHandle, hostname: mapping.hostname, path: pathForManifest ?? "", manifestHostHandle: args.next.hostHandle };
  if (pathForManifest === null || !sharedMarkerMatchesScope(marker, expected)) throw publicationError("This publication has not been approved for the current shared hostname and path. Review and approve the latest candidate first.");
  return { marker };
}

function missingSharedMarker(usesSharedWorker: boolean): null {
  if (usesSharedWorker) throw publicationError("This publication has not been approved for the shared hostname. Review and approve its current candidate first.");
  return null;
}

async function publicSlugForApproval(args: { store: Awaited<ReturnType<typeof storeFor>>["store"]; manifest: SiteEdgeManifest; pubId: string }): Promise<{ publicSlug?: string }> {
  if (args.manifest.tier !== "public") return {};
  const publicSlug = args.manifest.slug;
  sharedPublicPath(publicSlug);
  if (publicSlug === undefined) throw publicationError("A public shared-host publication needs an explicit slug before it can be approved.");
  await assertSlugAvailable({ store: args.store, slug: publicSlug, pubId: args.pubId });
  return { publicSlug };
}

async function writeManifest(args: { store: Awaited<ReturnType<typeof storeFor>>["store"]; pubId: string; next: SiteEdgeManifest }): Promise<void> {
  await args.store.put(`pubs/${args.pubId}/manifest.json`, { body: JSON.stringify(args.next) });
  const confirmed = await readSiteManifest(args.store, args.pubId);
  if (confirmed === null || stable(confirmed) !== stable(args.next)) throw publicationError("Cloudflare R2 did not confirm the requested publication state.");
}

async function persistApprovedSharedRoute(args: { store: Awaited<ReturnType<typeof storeFor>>["store"]; pubId: string; route: { marker: SharedRouteMarker; publicSlug?: string } }): Promise<void> {
  await args.store.put(sharedRouteMarkerKey(args.pubId), { body: JSON.stringify(args.route.marker), contentType: "application/json" });
  const savedMarker = await readSharedRouteMarker(args.store, args.pubId);
  if (!sharedMarkerMatchesScope(savedMarker, args.route.marker)) throw publicationError("Cloudflare R2 did not confirm the approved shared route marker.");
  if (args.route.publicSlug === undefined) return;
  await args.store.put(slugKey(args.route.publicSlug), { body: args.pubId, contentType: "text/plain" });
  const pointer = new TextDecoder().decode(await args.store.get(slugKey(args.route.publicSlug)));
  if (pointer !== args.pubId) throw publicationError("Cloudflare R2 did not confirm the public path pointer. Retry approval to finish shared-host routing.");
}

async function assertSlugAvailable(args: { store: Awaited<ReturnType<typeof storeFor>>["store"]; slug: string; pubId: string }): Promise<void> {
  const key = slugKey(args.slug);
  if (!(await args.store.list(key)).includes(key)) return;
  const pointedId = new TextDecoder().decode(await args.store.get(key));
  if (pointedId === args.pubId) return;
  let owner: SiteEdgeManifest | null;
  try { owner = await readSiteManifest(args.store, pointedId); } catch (_error) {
    throw publicationError(`The public path '${args.slug}' is already assigned to another publication. Choose a different slug.`);
  }
  if (owner !== null && owner.status !== "revoked" && owner.tier === "public" && owner.slug === args.slug) {
    throw publicationError(`The public path '${args.slug}' is already assigned to another publication. Choose a different slug.`);
  }
}

export async function approveManagedPublication(args: { boxRoot: string; boxSlug: string; pubId: string; expectedRevision: string }, injectedRuntime?: ManagedPublicationRuntime): Promise<void> {
  await mutateManifest({ ...args, action: "approve" }, injectedRuntime ?? defaultManagedPublicationRuntime);
}
export async function enableManagedPublication(args: { boxRoot: string; boxSlug: string; pubId: string }, injectedRuntime?: ManagedPublicationRuntime): Promise<void> {
  await mutateManifest({ ...args, action: "enable" }, injectedRuntime ?? defaultManagedPublicationRuntime);
}
export async function disableManagedPublication(args: { boxRoot: string; boxSlug: string; pubId: string }, injectedRuntime?: ManagedPublicationRuntime): Promise<void> {
  await mutateManifest({ ...args, action: "disable" }, injectedRuntime ?? defaultManagedPublicationRuntime);
}
export async function revokeManagedPublication(args: { boxRoot: string; boxSlug: string; pubId: string }, injectedRuntime?: ManagedPublicationRuntime): Promise<void> {
  await mutateManifest({ ...args, action: "revoke" }, injectedRuntime ?? defaultManagedPublicationRuntime);
}

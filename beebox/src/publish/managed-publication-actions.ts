import { mkdir } from "node:fs/promises";
import path from "node:path";

import { siteEdgeManifestSchema, type SiteEdgeManifest } from "./manifest-edge.js";
import { defaultManagedPublicationRuntime, type ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import { withFileLock } from "../lib/file-lock.js";
import { publicationError, readCandidate, readSiteManifest, stable, storeFor } from "./managed-publications.js";

async function manifestForApproval(input: { args: { pubId: string; expectedRevision?: string }; binding: NonNullable<Awaited<ReturnType<ManagedPublicationRuntime["getBinding"]>>>; store: Awaited<ReturnType<typeof storeFor>>["store"] }): Promise<SiteEdgeManifest> {
  const { args, binding, store } = input;
  const candidate = await readCandidate(store, args.pubId);
  if (candidate === null || candidate.revision !== args.expectedRevision) throw publicationError("The publication candidate changed. Review the latest candidate before approving it.");
  if (candidate.pubId !== binding.pubId || candidate.requestedScope.hostHandle !== binding.hostHandle) throw publicationError("The pending candidate does not match this server-owned publication binding.");
  const requestedHostname = "customHostname" in candidate.requestedScope ? candidate.requestedScope.customHostname : undefined;
  if ((requestedHostname ?? null) !== (binding.customHostname ?? null)) throw publicationError("The candidate hostname changed. Prepare the publication again before approving it.");
  if (binding.customHostname !== undefined && binding.customHostnameStatus !== "attached") throw publicationError("Cloudflare has not confirmed this hostname yet. Retry the hostname assignment before approving the publication.");
  if (candidate.requestedScope.tier === "accounts" || candidate.requestedScope.tier === "any-account") {
    throw publicationError("Account-restricted publication cannot be enabled until Cloudflare Access setup has been verified for this Worker host.");
  }
  const requested = siteEdgeManifestSchema.safeParse({
    ...candidate.requestedScope,
    status: "live",
    activeRelease: { id: candidate.releaseId, files: candidate.files },
  });
  if (!requested.success) throw publicationError("The pending publication scope or release is invalid.");
  return requested.data;
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
  await withFileLock({ lockPath: path.join(lockDir, `${args.pubId}.lock`), metadata: { purpose: `managed-publication-${args.action}`, pubId: args.pubId }, waitMs: 10_000 }, async () => {
    const binding = await runtime.getBinding({ pubId: args.pubId, boxSlug: args.boxSlug });
    if (binding === null) throw publicationError("Publication is not registered on this server.");
    const { store } = await storeFor({ binding, boxRoot: args.boxRoot, runtime, purpose: args.action === "disable" || args.action === "revoke" ? "publish-disable" : "publish-enable" });
    const manifest = await readSiteManifest(store, args.pubId);
    if (manifest === null) throw publicationError("Publication edge state is missing.");
    if (manifest.status === "revoked") throw publicationError("This publication is revoked and cannot be changed.");
    const next = args.action === "approve"
      ? await manifestForApproval({ args, binding, store })
      : manifestForStatus({ action: args.action, manifest, binding });
    await store.put(`pubs/${args.pubId}/manifest.json`, { body: JSON.stringify(next) });
    const confirmed = await readSiteManifest(store, args.pubId);
    if (confirmed === null || stable(confirmed) !== stable(next)) throw publicationError("Cloudflare R2 did not confirm the requested publication state.");
  });
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

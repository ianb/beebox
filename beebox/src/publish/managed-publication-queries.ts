import { createHash } from "node:crypto";
import path from "node:path";

import type { SiteEdgeManifest } from "./manifest-edge.js";
import { bundleContentType } from "./lifecycle.js";
import { staticBearer } from "../services/cloudflare-bearer.js";
import type { ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import { defaultManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import type { PublicationCandidate } from "./managed-publications.js";
import { publicationError, readCandidate, readSiteManifest, storeFor } from "./managed-publications.js";

const TEXT_ASSET_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".xml", ".webmanifest"]);
const PREVIEW_TEXT_LIMIT = 64 * 1024;

export async function listManagedPublications(args: { boxRoot: string; boxSlug: string }, injectedRuntime?: ManagedPublicationRuntime) {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  const { boxSlug } = args;
  const bindings = await runtime.listBindings(boxSlug);
  const rows = await runtime.listConnections();
  return Promise.all(bindings.map(async (binding) => {
    const row = rows.find((item) => item.name === binding.connectionName);
    const connection = row === undefined
      ? { name: binding.connectionName, status: "missing" as const, capabilities: { tokenForAccount: "unverified" as const, r2ObjectWrite: "unverified" as const, workerDeploy: "unverified" as const, accessLive: "unverified" as const } }
      : { name: row.name, status: row.tokenStatus, capabilities: row.capabilities };
    let manifest: SiteEdgeManifest | null = null;
    let candidate: PublicationCandidate | null = null;
    let hostname: string | null = null;
    let remoteStatus: { status: "available" } | { status: "unavailable"; reason: "connection-missing" | "connection-revoked" | "grant-missing" | "cloudflare-unavailable" } = { status: "unavailable", reason: "cloudflare-unavailable" };
    if (row === undefined) remoteStatus = { status: "unavailable", reason: "connection-missing" };
    else if (row.tokenStatus !== "active") remoteStatus = { status: "unavailable", reason: "connection-revoked" };
    else if (!row.grants.some((grant) => grant.boxSlug === boxSlug)) remoteStatus = { status: "unavailable", reason: "grant-missing" };
    else {
    try {
      const { credential, store } = await storeFor({ binding, boxRoot: args.boxRoot, runtime, purpose: "publish-prepare" });
      const provisioning = runtime.createProvisioning({ accountId: credential.accountId, bearer: staticBearer(credential.apiToken) });
      const subdomain = await provisioning.getAccountSubdomain();
      hostname = subdomain === null ? null : `${binding.hostHandle}.${subdomain}.workers.dev`;
      [manifest, candidate] = await Promise.all([readSiteManifest(store, binding.pubId), readCandidate(store, binding.pubId)]);
      remoteStatus = { status: "available" };
    } catch (_error) {
      remoteStatus = { status: "unavailable", reason: "cloudflare-unavailable" };
    }
    }
    return {
      pubId: binding.pubId,
      name: typeof candidate?.name === "string" ? candidate.name : binding.pubId,
      title: typeof candidate?.title === "string" ? candidate.title : binding.pubId,
      hostname,
      requested: candidate?.requestedScope ?? null,
      approved: manifest === null ? null : {
        tier: manifest.tier,
        status: manifest.status,
        ...(manifest.tier === "public" && manifest.slug !== undefined ? { slug: manifest.slug } : {}),
        ...(manifest.tier === "accounts" ? { allowedEmails: manifest.allowedEmails } : {}),
        expiresAt: manifest.expiresAt,
      },
      activeReleaseId: manifest?.activeRelease.id ?? null,
      remoteStatus,
      pending: candidate === null ? null : {
        revision: candidate.revision,
        releaseId: candidate.releaseId,
        preparedAt: candidate.preparedAt,
        requestedScope: candidate.requestedScope,
        preview: candidate.preview,
        scan: candidate.scan,
      },
      connection,
    };
  }));
}

export async function previewManagedPublicationFile(args: {
  boxRoot: string;
  boxSlug: string;
  pubId: string;
  expectedRevision: string;
  path: string;
}, injectedRuntime?: ManagedPublicationRuntime) {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  if (args.path.startsWith("/") || args.path.includes("\\") || args.path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw publicationError("Invalid publication file path.");
  }
  const binding = await runtime.getBinding({ pubId: args.pubId, boxSlug: args.boxSlug });
  if (binding === null) throw publicationError("Publication is not registered on this server.");
  const { store } = await storeFor({ binding, boxRoot: args.boxRoot, runtime, purpose: "publish-prepare" });
  const candidate = await readCandidate(store, args.pubId);
  if (candidate === null || candidate.revision !== args.expectedRevision) throw publicationError("The publication candidate changed. Refresh the preview before opening this file.");
  if (candidate.requestedScope.hostHandle !== binding.hostHandle || candidate.pubId !== binding.pubId) throw publicationError("The pending candidate does not match this server-owned publication binding.");
  const inventory = candidate.files[args.path];
  if (inventory === undefined) throw publicationError("That path is not in the pending publication inventory.");
  const extension = path.posix.extname(args.path).toLowerCase();
  const contentType = bundleContentType(args.path);
  if (!TEXT_ASSET_EXTENSIONS.has(extension)) return { kind: "binary" as const, bytes: inventory.bytes, contentType };
  if (inventory.bytes > PREVIEW_TEXT_LIMIT) return { kind: "too-large" as const, bytes: inventory.bytes, contentType, limit: PREVIEW_TEXT_LIMIT };
  const key = `pubs/${args.pubId}/releases/${candidate.releaseId}/${args.path}`;
  const bytes = await store.get(key);
  if (bytes.byteLength !== inventory.bytes || createHash("sha256").update(bytes).digest("hex") !== inventory.sha256) {
    throw publicationError("The pending publication file failed its integrity check.");
  }
  return { kind: "text" as const, text: new TextDecoder().decode(bytes), bytes: inventory.bytes, contentType, truncated: false };
}

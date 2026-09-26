import { createHash } from "node:crypto";
import path from "node:path";

import { sharedPublicSlugSchema, type SiteEdgeManifest } from "./manifest-edge.js";
import { bundleContentType } from "./lifecycle.js";
import { staticBearer } from "../services/cloudflare-bearer.js";
import type { ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import { defaultManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import type { PublicationCandidate } from "./managed-publications.js";
import { publicationError, readCandidate, readSharedRouteMarker, readSiteManifest, storeFor } from "./managed-publications.js";

const TEXT_ASSET_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".xml", ".webmanifest"]);
const PREVIEW_TEXT_LIMIT = 64 * 1024;

export async function listManagedPublications(args: { boxRoot: string; boxSlug: string }, injectedRuntime?: ManagedPublicationRuntime) {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  const [bindings, rows, boxHost] = await Promise.all([
    runtime.listBindings(args.boxSlug),
    runtime.listConnections(),
    runtime.getBoxHost(args.boxSlug),
  ]);
  const sites = await Promise.all(bindings.map((binding) => managedPublicationRow({ binding, args, runtime, rows, boxHost })));
  return {
    sharedHost: boxHost === null ? null : { hostname: boxHost.hostname, connectionName: boxHost.connectionName, status: boxHost.status },
    sites,
  };
}

async function managedPublicationRow(args: {
  binding: Awaited<ReturnType<ManagedPublicationRuntime["listBindings"]>>[number];
  args: { boxRoot: string; boxSlug: string };
  runtime: ManagedPublicationRuntime;
  rows: Awaited<ReturnType<ManagedPublicationRuntime["listConnections"]>>;
  boxHost: Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>;
}) {
  const { binding, boxHost } = args;
  const row = args.rows.find((item) => item.name === binding.connectionName);
  const connection = row === undefined
    ? { name: binding.connectionName, status: "missing" as const, capabilities: { tokenForAccount: "unverified" as const, r2ObjectWrite: "unverified" as const, workerDeploy: "unverified" as const, accessLive: "unverified" as const } }
    : { name: row.name, status: row.tokenStatus, capabilities: row.capabilities };
  const remote = await readRemotePublication({ ...args, row });
  const { manifest, candidate, sharedRoute, hostname, remoteStatus } = remote;
  return {
    pubId: binding.pubId,
    assignedCustomHostname: binding.customHostname ?? null,
    customHostnameStatus: binding.customHostnameStatus ?? null,
    name: typeof candidate?.name === "string" ? candidate.name : binding.pubId,
    title: typeof candidate?.title === "string" ? candidate.title : binding.pubId,
    hostname,
    sharedRoute,
    requested: candidate?.requestedScope ?? null,
    approved: manifest === null ? null : {
      tier: manifest.tier,
      status: manifest.status,
      ...(manifest.tier === "public" && manifest.slug !== undefined ? { slug: manifest.slug } : {}),
      ...(manifest.tier === "accounts" ? { allowedEmails: manifest.allowedEmails } : {}),
      ...(manifest.customHostname === undefined ? {} : { customHostname: manifest.customHostname }),
      ...(sharedRoute === null || boxHost === null ? {} : { sharedHost: { hostname: sharedRoute.hostname, hostHandle: boxHost.hostHandle, path: sharedRoute.path } }),
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
}

async function readRemotePublication(args: {
  binding: Awaited<ReturnType<ManagedPublicationRuntime["listBindings"]>>[number];
  args: { boxRoot: string; boxSlug: string };
  runtime: ManagedPublicationRuntime;
  row: Awaited<ReturnType<ManagedPublicationRuntime["listConnections"]>>[number] | undefined;
  boxHost: Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>;
}): Promise<{
  manifest: SiteEdgeManifest | null;
  candidate: PublicationCandidate | null;
  sharedRoute: { hostname: string; path: string } | null;
  hostname: string | null;
  remoteStatus: { status: "available" } | { status: "unavailable"; reason: "connection-missing" | "connection-revoked" | "grant-missing" | "cloudflare-unavailable" };
}> {
  const unavailable = (reason: "connection-missing" | "connection-revoked" | "grant-missing" | "cloudflare-unavailable") => ({ manifest: null, candidate: null, sharedRoute: null, hostname: null, remoteStatus: { status: "unavailable" as const, reason } });
  const { row, binding, runtime } = args;
  if (row === undefined) return unavailable("connection-missing");
  if (row.tokenStatus !== "active") return unavailable("connection-revoked");
  if (!row.grants.some((grant) => grant.boxSlug === args.args.boxSlug)) return unavailable("grant-missing");
  try {
    const { credential, store } = await storeFor({ binding, boxRoot: args.args.boxRoot, runtime, purpose: "publish-prepare" });
    const provisioning = runtime.createProvisioning({ accountId: credential.accountId, bearer: staticBearer(credential.apiToken) });
    const isSharedWorker = args.boxHost !== null && args.boxHost.status === "attached" && args.boxHost.connectionName === binding.connectionName
      && args.boxHost.workerName === binding.workerName && args.boxHost.hostHandle === binding.hostHandle && args.boxHost.bucketName === binding.bucketName;
    let hostname: string | null = null;
    if (!isSharedWorker) {
      const subdomain = await provisioning.getAccountSubdomain();
      hostname = subdomain === null ? null : `${binding.hostHandle}.${subdomain}.workers.dev`;
    }
    const [manifest, candidate] = await Promise.all([readSiteManifest(store, binding.pubId), readCandidate(store, binding.pubId)]);
    const sharedRoute = await verifiedSharedRoute({ store, manifest, binding, boxHost: args.boxHost });
    return { manifest, candidate, sharedRoute, hostname, remoteStatus: { status: "available" } };
  } catch (_error) {
    return unavailable("cloudflare-unavailable");
  }
}

async function verifiedSharedRoute(args: {
  store: Awaited<ReturnType<typeof storeFor>>["store"];
  manifest: SiteEdgeManifest | null;
  binding: Awaited<ReturnType<ManagedPublicationRuntime["listBindings"]>>[number];
  boxHost: Awaited<ReturnType<ManagedPublicationRuntime["getBoxHost"]>>;
}): Promise<{ hostname: string; path: string } | null> {
  const { manifest, binding, boxHost } = args;
  if (boxHost === null || boxHost.status !== "attached" || boxHost.connectionName !== binding.connectionName || manifest === null) return null;
  const marker = await readSharedRouteMarker(args.store, binding.pubId);
  if (marker === null) return null;
  const expectedPath = manifest.tier === "public" && manifest.slug !== undefined && sharedPublicSlugSchema.safeParse(manifest.slug).success
    ? `/${manifest.slug}/`
    : manifest.tier === "secret" ? `/s/${binding.pubId}/` : null;
  if (expectedPath === null || marker.pubId !== binding.pubId || marker.boxHostHandle !== boxHost.hostHandle
    || marker.hostname !== boxHost.hostname || marker.path !== expectedPath || marker.manifestHostHandle !== manifest.hostHandle) return null;
  return { hostname: marker.hostname, path: marker.path };
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

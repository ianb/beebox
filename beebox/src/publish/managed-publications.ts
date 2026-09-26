import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { filesSchema, releaseIdForFiles, sharedMarkerMatchesScope, sharedPublicSlugSchema, sharedRouteMarkerKey, sharedRouteMarkerSchema, siteEdgeManifestSchema, type SharedRouteMarker, type SiteEdgeManifest } from "./manifest-edge.js";
import type { PreparedPublication } from "./prepare.js";
import type { ManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import { defaultManagedPublicationRuntime } from "../services/managed-publication-runtime.js";
import type { PublishRemoteStore } from "../services/publish-remote-store.js";
import { staticBearer } from "../services/cloudflare-bearer.js";
import { withFileLock } from "../lib/file-lock.js";
import { ensureWorkerDeployment } from "./managed-publication-workers.js";

const SCAN_SAMPLE_LIMIT = 100;
const PREVIOUS_RELEASE_MS = 10 * 60 * 1000;

class ManagedPublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedPublicationError";
  }
}

export function publicationError(message: string): ManagedPublicationError {
  return new ManagedPublicationError(message);
}

const scanFindingSchema = z.object({ id: z.string(), kind: z.enum(["home-path", "email", "credential", "external-url"]), file: z.string(), match: z.string(), detail: z.string(), line: z.number().int().positive() }).strict();
const candidateScopeSchema = z.discriminatedUnion("tier", [
  z.object({ kind: z.literal("site"), hostHandle: z.string(), tier: z.literal("public"), expiresAt: z.null(), slug: z.string().optional(), customHostname: z.string().optional(), sharedHost: z.object({ hostname: z.string(), hostHandle: z.string(), path: z.string() }).strict().optional() }).strict(),
  z.object({ kind: z.literal("site"), hostHandle: z.string(), tier: z.literal("secret"), expiresAt: z.null(), customHostname: z.string().optional(), sharedHost: z.object({ hostname: z.string(), hostHandle: z.string(), path: z.string() }).strict().optional() }).strict(),
  z.object({ kind: z.literal("site"), hostHandle: z.string(), tier: z.literal("accounts"), expiresAt: z.null(), allowedEmails: z.array(z.string().email()) }).strict(),
  z.object({ kind: z.literal("site"), hostHandle: z.string(), tier: z.literal("any-account"), expiresAt: z.null() }).strict(),
]);
const candidateSchema = z.object({
  schemaVersion: z.literal(1),
  pubId: z.string().regex(/^[2-7a-z]{26}$/),
  name: z.string(),
  title: z.string(),
  requestedScope: candidateScopeSchema,
  releaseId: z.string().regex(/^[\da-f]{64}$/),
  files: filesSchema,
  preview: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string() }).strict()),
  scan: z.object({
    total: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
    skippedBinaries: z.number().int().nonnegative(),
    sample: z.array(scanFindingSchema).max(SCAN_SAMPLE_LIMIT),
  }).strict(),
  preparedAt: z.string().datetime({ offset: true }),
  revision: z.string().regex(/^[\da-f]{64}$/),
}).strict();

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (!isObjectRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).toSorted().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function isObjectRecord(value: object): value is Record<string, unknown> { return !Array.isArray(value); }

function requestedScope(prepared: PreparedPublication, routing: { hostHandle: string; customHostname?: string; sharedHost?: { hostname: string; hostHandle: string } }) {
  const { hostHandle, customHostname, sharedHost } = routing;
  const definition = prepared.definition;
  const sharedPath = definition.tier === "public" ? (sharedHost === undefined ? undefined : sharedPublicPath(definition.slug)) : `/s/${prepared.pubId}/`;
  const sharedDestination = sharedHost === undefined || sharedPath === undefined ? undefined : { hostname: sharedHost.hostname, hostHandle: sharedHost.hostHandle, path: sharedPath };
  if (definition.tier === "public") return { kind: "site" as const, hostHandle, tier: "public" as const, expiresAt: null, ...(definition.slug === undefined ? {} : { slug: definition.slug }), ...(customHostname === undefined ? {} : { customHostname }), ...(sharedDestination === undefined ? {} : { sharedHost: sharedDestination }) };
  if (definition.tier === "secret") return { kind: "site" as const, hostHandle, tier: "secret" as const, expiresAt: null, ...(customHostname === undefined ? {} : { customHostname }), ...(sharedDestination === undefined ? {} : { sharedHost: sharedDestination }) };
  if (definition.tier === "accounts") return { kind: "site" as const, hostHandle, tier: "accounts" as const, expiresAt: null, allowedEmails: definition.emails };
  return { kind: "site" as const, hostHandle, tier: "any-account" as const, expiresAt: null };
}

function withoutSharedHost(scope: ReturnType<typeof requestedScope>) {
  if (!("sharedHost" in scope)) return scope;
  const { sharedHost: _sharedHost, ...manifestScope } = scope;
  return manifestScope;
}

export function sharedPublicPath(slug: string | undefined): string {
  if (slug === undefined) throw publicationError("A public publication on the shared hostname needs an explicit slug. Add a slug such as 'hello' to its publication definition and prepare it again.");
  if (!sharedPublicSlugSchema.safeParse(slug).success) throw publicationError(`The public slug '${slug}' cannot be used at the shared-host root. Use a lowercase slug of at most 63 characters other than s, p, or a.`);
  return `/${slug}/`;
}

function sameScope(a: SiteEdgeManifest, scope: ReturnType<typeof requestedScope>): boolean {
  return stable({ ...a, status: undefined, activeRelease: undefined, previousRelease: undefined }) === stable({ ...withoutSharedHost(scope), status: undefined, activeRelease: undefined, previousRelease: undefined });
}
async function hasObject(store: PublishRemoteStore, key: string): Promise<boolean> {
  return (await store.list(key)).includes(key);
}
export async function readSiteManifest(store: PublishRemoteStore, pubId: string): Promise<SiteEdgeManifest | null> {
  const key = `pubs/${pubId}/manifest.json`; if (!(await hasObject(store, key))) return null;
  const raw = await store.get(key);
  const parsed = siteEdgeManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(raw)));
  if (!parsed.success) throw publicationError("The publication edge manifest is invalid; refusing to replace it.");
  return parsed.data;
}

export async function readSharedRouteMarker(store: PublishRemoteStore, pubId: string): Promise<SharedRouteMarker | null> {
  const key = sharedRouteMarkerKey(pubId);
  if (!(await hasObject(store, key))) return null;
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(await store.get(key))); } catch (_error) { throw publicationError("The shared publication route marker is invalid JSON."); }
  const parsed = sharedRouteMarkerSchema.safeParse(json);
  if (!parsed.success || parsed.data.pubId !== pubId) throw publicationError("The shared publication route marker is malformed or bound to another publication.");
  return parsed.data;
}
export type PublicationCandidate = z.infer<typeof candidateSchema>;

export async function readCandidate(store: PublishRemoteStore, pubId: string): Promise<PublicationCandidate | null> {
  const key = `pubs/${pubId}/pending.json`; if (!(await hasObject(store, key))) return null;
  let json: unknown; try { json = JSON.parse(new TextDecoder().decode(await store.get(key))); } catch (_error) { throw publicationError("The pending publication candidate is invalid JSON."); }
  const parsed = candidateSchema.safeParse(json);
  if (!parsed.success || parsed.data.pubId !== pubId) throw publicationError("The pending publication candidate is malformed or bound to another publication.");
  const { revision: candidateRevision, ...body } = parsed.data;
  if (createHash("sha256").update(stable(body)).digest("hex") !== candidateRevision || await releaseIdForFiles(parsed.data.files) !== parsed.data.releaseId) throw publicationError("The pending publication candidate revision or release inventory does not match its contents.");
  return parsed.data;
}

export function storeFor(args: { binding: { pubId: string; boxSlug: string; connectionName: string; bucketName: string }; boxRoot: string; runtime: ManagedPublicationRuntime; purpose: "publish-prepare" | "publish-enable" | "publish-disable" }) {
  const { binding, boxRoot, runtime, purpose } = args;
  return runtime.resolveCredential({ name: binding.connectionName, boxSlug: binding.boxSlug, purpose, at: runtime.now(boxRoot).toISOString() })
    .then((credential) => ({
      credential,
      store: runtime.createStore({ accountId: credential.accountId, bucket: binding.bucketName, bearer: staticBearer(credential.apiToken) }),
    }));
}

function scanSummary(prepared: PreparedPublication) {
  const findings = prepared.scan.findings;
  const byKind: Record<string, number> = {};
  for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  return {
    total: findings.length,
    byKind,
    skippedBinaries: prepared.scan.skippedBinaries.length,
    sample: findings.slice(0, SCAN_SAMPLE_LIMIT),
  };
}

async function uploadReleaseFiles(args: {
  prepared: PreparedPublication;
  releaseId: string;
  store: PublishRemoteStore;
  runtime: ManagedPublicationRuntime;
  connectionName: string;
  boxRoot: string;
}): Promise<void> {
  for (const file of args.prepared.files) {
    const bytes = await readFile(path.join(args.prepared.stagedDir, ...file.path.split("/")));
    if (bytes.byteLength !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw publicationError(`Prepared file changed before upload: ${file.path}`);
    }
    await args.store.put(`pubs/${args.prepared.pubId}/releases/${args.releaseId}/${file.path}`, { body: bytes });
  }
  await args.runtime.markCapability({
    name: args.connectionName,
    capability: "r2ObjectWrite",
    verifiedAt: args.runtime.now(args.boxRoot).toISOString(),
  });
}

async function persistPreparedCandidate(args: {
  boxRoot: string;
  boxSlug: string;
  pubId: string;
  store: PublishRemoteStore;
  existing: SiteEdgeManifest | null;
  scope: ReturnType<typeof requestedScope>;
  candidate: PublicationCandidate;
  runtime: ManagedPublicationRuntime;
}): Promise<void> {
  const lockDir = path.join(args.boxRoot, ".beebox", "publish-locks");
  await mkdir(lockDir, { recursive: true });
  await withFileLock({ lockPath: path.join(lockDir, `${args.pubId}.lock`), metadata: { purpose: "managed-publication-prepare", pubId: args.pubId }, waitMs: 10_000 }, async () => {
    const binding = await args.runtime.getBinding({ pubId: args.pubId, boxSlug: args.boxSlug });
    if (binding === null || binding.hostHandle !== args.scope.hostHandle) throw publicationError("The publication binding changed during preparation; prepare it again before continuing.");
    const assignedHostname = binding.customHostname;
    const candidateHostname = "customHostname" in args.scope ? args.scope.customHostname : undefined;
    if ((assignedHostname ?? null) !== (candidateHostname ?? null)) throw publicationError("The hostname assignment changed during preparation; retry preparation to retain the assigned hostname.");
    const latest = await readSiteManifest(args.store, args.pubId);
    if (args.existing === null && latest !== null) throw publicationError("Publication was created concurrently; refresh and review its latest state.");
    if (args.existing !== null && latest === null) throw publicationError("Publication state disappeared during preparation; no update was made.");
    if (latest !== null && latest.hostHandle !== args.scope.hostHandle) throw publicationError("Remote publication state belongs to a different Worker host; refusing to replace it.");
    if (latest?.status === "revoked") throw publicationError("This publication was revoked during preparation; no live change was made.");
    await args.store.put(`pubs/${args.pubId}/pending.json`, { body: JSON.stringify(args.candidate) });
    if (!await shouldAutoRefreshManifest({ latest, scope: args.scope, store: args.store, pubId: args.pubId })) return;
    const next = siteEdgeManifestSchema.parse({
      ...withoutSharedHost(args.scope),
      status: latest === null ? "disabled" : "live",
      activeRelease: { id: args.candidate.releaseId, files: args.candidate.files },
      ...(latest !== null && latest.activeRelease.id !== args.candidate.releaseId ? {
        previousRelease: { ...latest.activeRelease, expiresAt: new Date(args.runtime.now(args.boxRoot).getTime() + PREVIOUS_RELEASE_MS).toISOString() },
      } : {}),
    });
      await args.store.put(`pubs/${args.pubId}/manifest.json`, { body: JSON.stringify(next) });
    const confirmed = await readSiteManifest(args.store, args.pubId);
    if (confirmed === null || stable(confirmed) !== stable(next)) throw publicationError("Cloudflare R2 did not confirm the publication state update.");
  });
}

async function shouldAutoRefreshManifest(args: { latest: SiteEdgeManifest | null; scope: ReturnType<typeof requestedScope>; store: PublishRemoteStore; pubId: string }): Promise<boolean> {
  if (args.latest === null) return true;
  if (args.latest.status === "disabled" || !sameScope(args.latest, args.scope)) return false;
  const host = "sharedHost" in args.scope ? args.scope.sharedHost : undefined;
  if (host === undefined) return true;
  const marker = await readSharedRouteMarker(args.store, args.pubId);
  return sharedMarkerMatchesScope(marker, { schemaVersion: 1, pubId: args.pubId, boxHostHandle: host.hostHandle, hostname: host.hostname, path: host.path, manifestHostHandle: args.scope.hostHandle });
}

export interface ManagedPublicationCandidate {
  pubId: string;
  name: string;
  title: string;
  revision: string;
  releaseId: string;
  requestedScope: ReturnType<typeof requestedScope>;
  preparedAt: string;
  preview: PreparedPublication["preview"];
  scan: ReturnType<typeof scanSummary>;
}

export async function prepareManagedPublication(args: {
  boxRoot: string;
  boxSlug: string;
  name: string;
  ownerEmail: string | null;
}, injectedRuntime?: ManagedPublicationRuntime): Promise<ManagedPublicationCandidate> {
  const runtime = injectedRuntime ?? defaultManagedPublicationRuntime;
  const result = await runtime.prepare({ boxRoot: args.boxRoot, name: args.name }, { ownerEmail: args.ownerEmail });
  if (!result.ok) throw publicationError(result.message);
  const prepared = result.prepared;
  try {
    const binding = await reservePublicationBinding({ prepared, args, runtime });
    const connection = await runtime.resolveCredential({ name: prepared.definition.connection, boxSlug: args.boxSlug, purpose: "publish-prepare", at: runtime.now(args.boxRoot).toISOString() });
    if (connection.accountId !== binding.accountId) throw publicationError("The publication binding is pinned to another Cloudflare account.");
    const bearer = staticBearer(connection.apiToken);
    const store = runtime.createStore({ accountId: connection.accountId, bucket: binding.bucketName, bearer });
    const provisioning = runtime.createProvisioning({ accountId: connection.accountId, bearer });
    await provisioning.createBucket(binding.bucketName);
    const boxHost = await runtime.getBoxHost(args.boxSlug);
    const sameConnectionHost = boxHost !== null && boxHost.status === "attached" && boxHost.connectionName === binding.connectionName;
    const alreadyUsesSharedWorker = sameConnectionHost && boxHost.workerName === binding.workerName && boxHost.hostHandle === binding.hostHandle && boxHost.bucketName === binding.bucketName;
    const unscopedLegacyPublic = prepared.definition.tier === "public" && prepared.definition.slug === undefined && !alreadyUsesSharedWorker;
    const useSharedHost = sameConnectionHost && !unscopedLegacyPublic;
    const sharedHost = useSharedHost ? boxHost : null;
    if (!useSharedHost && await provisioning.getAccountSubdomain() === null) throw publicationError("This Cloudflare account has no workers.dev subdomain configured.");
    if (useSharedHost && prepared.definition.tier === "public") sharedPublicPath(prepared.definition.slug);
    const files = Object.fromEntries(prepared.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }]));
    const releaseId = await releaseIdForFiles(files);
    if (releaseId !== prepared.contentHash) throw publicationError("Prepared release inventory changed before upload.");
    await uploadReleaseFiles({ prepared, releaseId, store, runtime, connectionName: prepared.definition.connection, boxRoot: args.boxRoot });
    const existing = await readSiteManifest(store, prepared.pubId);
    await assertRemoteOwnership({ existing, store, pubId: prepared.pubId, hostHandle: binding.hostHandle });
    if (existing?.status === "revoked") throw publicationError("This publication is revoked and cannot be refreshed. Create a new publication id.");
    await ensureWorkerDeployment({ runtime, boxRoot: args.boxRoot, credential: connection, provisioning, pubId: prepared.pubId, reserved: binding, connectionName: prepared.definition.connection, fail: publicationError });
    if (binding.customHostname !== undefined && prepared.definition.tier !== "public" && prepared.definition.tier !== "secret") {
      throw publicationError("Custom hostnames are supported only for public or secret publications.");
    }
    const scope = requestedScope(prepared, {
      hostHandle: binding.hostHandle,
      ...(binding.customHostname === undefined ? {} : { customHostname: binding.customHostname }),
      ...(sharedHost === null ? {} : { sharedHost: { hostname: sharedHost.hostname, hostHandle: sharedHost.hostHandle } }),
    });
    const candidateBody = {
      schemaVersion: 1 as const,
      pubId: prepared.pubId,
      name: args.name,
      title: prepared.definition.title,
      requestedScope: scope,
      releaseId,
      files,
      preview: prepared.preview,
      scan: scanSummary(prepared),
      preparedAt: runtime.now(args.boxRoot).toISOString(),
    };
    const candidate = { ...candidateBody, revision: createHash("sha256").update(stable(candidateBody)).digest("hex") };
    await persistPreparedCandidate({ boxRoot: args.boxRoot, boxSlug: args.boxSlug, pubId: prepared.pubId, store, existing, scope, candidate, runtime });
    return { pubId: prepared.pubId, name: args.name, title: prepared.definition.title, revision: candidate.revision, releaseId, requestedScope: scope, preparedAt: candidate.preparedAt, preview: prepared.preview, scan: candidate.scan };
  } finally {
    await prepared.cleanup();
  }
}

async function reservePublicationBinding(args: {
  prepared: PreparedPublication;
  args: { boxRoot: string; boxSlug: string };
  runtime: ManagedPublicationRuntime;
}): Promise<Awaited<ReturnType<ManagedPublicationRuntime["reserveBinding"]>>> {
  const existing = await args.runtime.getBinding({ pubId: args.prepared.pubId, boxSlug: args.args.boxSlug });
  const boxHost = await args.runtime.getBoxHost(args.args.boxSlug);
  if (existing === null && boxHost === null) throw publicationError("Set up this box's shared publishing hostname in Admin before preparing its first managed publication.");
  if (existing === null && boxHost?.status !== "attached") throw publicationError("Shared-host setup is still pending. Finish it in Admin before preparing this publication.");
  if (existing === null && boxHost?.connectionName !== args.prepared.definition.connection) throw publicationError(`This new publication must use the box's shared publishing connection '${boxHost?.connectionName ?? ""}'.`);
  const hostHandle = existing?.hostHandle ?? boxHost?.hostHandle ?? args.runtime.newHostHandle();
  return args.runtime.reserveBinding({
    pubId: args.prepared.pubId,
    boxSlug: args.args.boxSlug,
    connectionName: args.prepared.definition.connection,
    bucketName: existing?.bucketName ?? boxHost?.bucketName ?? args.runtime.newBucketName(),
    workerName: existing?.workerName ?? boxHost?.workerName ?? hostHandle,
    hostHandle,
    createdAt: args.runtime.now(args.args.boxRoot).toISOString(),
  });
}

async function assertRemoteOwnership(args: { existing: SiteEdgeManifest | null; store: PublishRemoteStore; pubId: string; hostHandle: string }): Promise<void> {
  if (args.existing !== null && args.existing.hostHandle !== args.hostHandle) {
    throw publicationError("Remote publication state belongs to a different Worker host; refusing to replace it.");
  }
  const candidate = await readCandidate(args.store, args.pubId);
  if (candidate !== null && candidate.requestedScope.hostHandle !== args.hostHandle) {
    throw publicationError("Remote candidate belongs to a different Worker host; refusing to replace it.");
  }
}

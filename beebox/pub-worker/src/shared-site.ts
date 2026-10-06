/** Shared-host routing through an approved per-publication route marker. */

import { sharedPublicSlugSchema, sharedRouteMarkerKey, sharedRouteMarkerSchema, slugKey, type SiteEdgeManifest } from "../../src/publish/manifest-edge";
import { decodeSegment } from "./asset-path";
import type { WorkerDeps } from "./deps";
import type { Env } from "./env";
import { isExpired, loadManifest } from "./manifest-store";
import { gone, methodNotAllowed, notFound } from "./responses";
import { redirectStableDirectory, serveSiteAssets } from "./site";

const PUB_ID_RE = /^[2-7a-z]{26}$/;

interface SharedIdentity {
  boxHostHandle: string;
  hostname: string;
}

/** Presence of any shared binding claims this mode; malformed claims fail closed. */
export function hasSharedHostBindings(env: Env): boolean {
  return env.PUB_WORKER_MODE !== undefined || env.PUB_BOX_HANDLE !== undefined || env.PUB_HOSTNAME !== undefined;
}

export function readSharedHostIdentity(env: Env): SharedIdentity | null {
  if (env.PUB_WORKER_MODE !== "shared-v1") return null;
  const boxHostHandle = env.PUB_BOX_HANDLE;
  const hostname = env.PUB_HOSTNAME;
  if (boxHostHandle === undefined || boxHostHandle.length === 0 || hostname === undefined || hostname.length === 0) return null;
  try {
    const parsed = new URL(`https://${hostname}`);
    if (parsed.hostname !== hostname.toLowerCase() || parsed.host !== parsed.hostname || parsed.pathname !== "/") return null;
  } catch (_error) {
    return null;
  }
  return { boxHostHandle, hostname };
}

/** Serve one shared-host request. A route marker enrolls the route; manifest remains authoritative. */
export async function handleSharedSite({ request, env, deps, identity }: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
  identity: SharedIdentity | null;
}): Promise<Response> {
  if (identity === null) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

  const url = new URL(request.url);
  if (url.port.length > 0 || normalizeHostname(url.hostname) !== normalizeHostname(identity.hostname)) return notFound();
  const route = parseSharedPath(url.pathname);
  if (route === null) return notFound();
  const pubId = await resolveSharedPubId(route, env);
  if (pubId === null) return notFound();
  const manifest = await loadAuthorizedSharedManifest({ route, pubId, identity, env });
  if (manifest === null) return notFound();
  if (manifest.status === "revoked" || isExpired(manifest.expiresAt, deps.now())) return gone();
  if (manifest.status !== "live") return gone();

  const directoryRedirect = redirectStableDirectory({ request, basePath: route.basePath, assetSegments: route.assetSegments, manifest });
  if (directoryRedirect !== null) return directoryRedirect;
  return serveSiteAssets({
    request,
    env,
    manifest,
    pubId,
    assetSegments: route.assetSegments,
  });
}

async function resolveSharedPubId(route: SharedRoute, env: Env): Promise<string | null> {
  if (route.kind === "public") {
    const pointer = await env.PUB_STORE.get(slugKey(route.slug));
    if (pointer === null) return null;
    const pubId = (await pointer.text()).trim();
    return PUB_ID_RE.test(pubId) ? pubId : null;
  }
  return route.pubId;
}

async function loadAuthorizedSharedManifest({ route, pubId, identity, env }: {
  route: SharedRoute;
  pubId: string;
  identity: SharedIdentity;
  env: Env;
}): Promise<SiteEdgeManifest | null> {
  const markerObject = await env.PUB_STORE.get(sharedRouteMarkerKey(pubId));
  if (markerObject === null) return null;
  let rawMarker: unknown;
  try { rawMarker = JSON.parse(await markerObject.text()); } catch (_error) { return null; }
  const parsedMarker = sharedRouteMarkerSchema.safeParse(rawMarker);
  if (!parsedMarker.success) return null;
  const marker = parsedMarker.data;
  if (marker.pubId !== pubId
    || marker.boxHostHandle !== identity.boxHostHandle
    || normalizeHostname(marker.hostname) !== normalizeHostname(identity.hostname)
    || marker.path !== route.basePath) return null;

  const stored = await loadManifest(pubId, env);
  if (stored === null || stored.hostHandle !== marker.manifestHostHandle) return null;
  if (route.kind === "public") {
    if (stored.tier !== "public" || stored.slug !== route.slug) return null;
    const pointer = await env.PUB_STORE.get(`slugs/${route.slug}`);
    if (pointer === null || (await pointer.text()).trim() !== pubId) return null;
  } else if (stored.tier !== "secret") {
    return null;
  }
  return stored;
}

type SharedRoute =
  | { kind: "public"; pubId?: never; slug: string; basePath: string; assetSegments: readonly string[] }
  | { kind: "secret"; pubId: string; slug?: never; basePath: string; assetSegments: readonly string[] };

function parseSharedPath(pathname: string): SharedRoute | null {
  const raw = pathname.split("/");
  raw.shift();
  if (raw.at(-1) === "") raw.pop();
  if (raw.length === 0 || raw.some((segment) => segment.length === 0)) return null;
  const first = decodeSegment(raw[0] ?? "");
  if (first === null || first.startsWith("__") || first === "p" || first === "a") return null;

  if (first === "s") {
    const pubId = decodeSegment(raw[1] ?? "");
    if (pubId === null || !PUB_ID_RE.test(pubId)) return null;
    return { kind: "secret", pubId, basePath: `/s/${pubId}/`, assetSegments: withDirectoryIndex(raw.slice(2), pathname.endsWith("/")) };
  }
  if (!sharedPublicSlugSchema.safeParse(first).success) return null;
  return {
    kind: "public",
    slug: first,
    basePath: `/${first}/`,
    assetSegments: withDirectoryIndex(raw.slice(1), pathname.endsWith("/")),
  };
}

function withDirectoryIndex(segments: readonly string[], trailingSlash: boolean): readonly string[] {
  if (trailingSlash) return [...segments, "index.html"];
  return segments;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

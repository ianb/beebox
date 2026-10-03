/** Serving for one Worker pinned to one box publication and random host handle. */

import type { SiteEdgeManifest } from "../../src/publish/manifest-edge";
import { authenticateAccess } from "./access-auth";
import { resolveAssetPath, decodeSegment } from "./asset-path";
import { contentTypeFor } from "./content-type";
import type { WorkerDeps } from "./deps";
import type { Env } from "./env";
import { assertNever } from "./exhaustive";
import { isExpired, loadManifest } from "./manifest-store";
import { forbidden, gone, methodNotAllowed, notFound } from "./responses";

const PUB_ID_RE = /^[2-7a-z]{26}$/;

export interface SiteWorkerIdentity {
  pubId: string;
  hostHandle: string;
}

/** True only when both pinned bindings are present and valid. */
export function readSiteWorkerIdentity(env: Env): SiteWorkerIdentity | null {
  const pubId = env.PUB_ID;
  const hostHandle = env.HOST_HANDLE;
  if (pubId === undefined && hostHandle === undefined) return null;
  if (pubId === "" && hostHandle === "") return null;
  if (pubId === undefined || hostHandle === undefined || pubId.length === 0 || hostHandle.length === 0) {
    return { pubId: "", hostHandle: "" };
  }
  if (!PUB_ID_RE.test(pubId) || /^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/.test(hostHandle) === false) {
    return { pubId: "", hostHandle: "" };
  }
  return { pubId, hostHandle };
}

export function hasPinnedSiteBindings(env: Env): boolean {
  return env.PUB_ID !== undefined || env.HOST_HANDLE !== undefined;
}

/** Handle a request under a pinned site identity; invalid bindings fail closed. */
export async function handleSite({
  request,
  env,
  deps,
  identity,
}: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
  identity: SiteWorkerIdentity | null;
}): Promise<Response> {
  if (identity === null || identity.pubId.length === 0) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

  const manifest = await loadManifest(identity.pubId, env);
  if (manifest === null) return notFound();
  if (manifest.hostHandle !== identity.hostHandle) return notFound();
  if (manifest.status === "revoked" || isExpired(manifest.expiresAt, deps.now())) return gone();
  if (manifest.status === "disabled") return gone();

  const url = new URL(request.url);
  const requested = parseSitePath({ pathname: url.pathname, pubId: identity.pubId, manifest });
  if (requested === null) return notFound();

  const access = await authorizeViewer({ manifest, request, env, deps });
  if (access !== null) return access;
  const directoryRedirect = redirectStableDirectory({ request, basePath: requested.basePath, assetSegments: requested.assetSegments, manifest });
  if (directoryRedirect !== null) return directoryRedirect;
  return serveSiteAssets({
    request,
    env,
    manifest,
    pubId: identity.pubId,
    assetSegments: requested.assetSegments,
  });
}

/** Keep relative URLs anchored to stable directory routes by adding their slash. */
export function redirectStableDirectory({ request, basePath, assetSegments, manifest }: {
  request: Request;
  basePath: string;
  assetSegments: readonly string[];
  manifest: SiteEdgeManifest;
}): Response | null {
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/")) return null;
  const assetPath = resolveAssetPath(assetSegments);
  if (assetPath === null) return null;
  const isMountRoot = basePath !== "/" && pathname === basePath.slice(0, -1);
  const isDirectory = !Object.prototype.hasOwnProperty.call(manifest.activeRelease.files, assetPath)
    && Object.prototype.hasOwnProperty.call(manifest.activeRelease.files, `${assetPath}/index.html`);
  if (!isMountRoot && !isDirectory) return null;
  const target = new URL(request.url);
  target.pathname += "/";
  return Response.redirect(target.toString(), 308);
}

/** Common active-release renderer used by pinned and shared-host Workers. */
export async function serveSiteAssets({ request, env, manifest, pubId, assetSegments }: {
  request: Request;
  env: Env;
  manifest: SiteEdgeManifest;
  pubId: string;
  assetSegments: readonly string[];
}): Promise<Response> {
  const assetPath = resolveAssetPath(assetSegments);
  if (assetPath === null) return notFound();
  const active = manifest.activeRelease;
  if (!Object.prototype.hasOwnProperty.call(active.files, assetPath)) return notFound();
  return serveReleaseFile({ request, env, pubId, release: active, assetPath });
}

async function serveReleaseFile({ request, env, pubId, release, assetPath }: {
  request: Request;
  env: Env;
  pubId: string;
  release: SiteEdgeManifest["activeRelease"];
  assetPath: string;
}): Promise<Response> {
  const object = await env.PUB_STORE.get(`pubs/${pubId}/releases/${release.id}/${assetPath}`);
  if (object === null) return notFound();
  const headers = new Headers({
    "Content-Type": contentTypeFor(assetPath),
    "Content-Length": String(release.files[assetPath]?.bytes ?? 0),
  });
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

interface SitePath {
  basePath: string;
  assetSegments: readonly string[];
}

function parseSitePath({ pathname, pubId, manifest }: { pathname: string; pubId: string; manifest: SiteEdgeManifest }): SitePath | null {
  const segments = pathname.split("/");
  segments.shift();
  const hasTrailingSlash = segments.at(-1) === "";
  if (hasTrailingSlash) segments.pop();
  if (segments.some((segment) => segment.length === 0)) return null;

  let stableSegments = segments;
  let basePath = "/";
  if (manifest.tier === "secret" || manifest.tier === "accounts" || manifest.tier === "any-account") {
    const expectedPrefix = manifest.tier === "secret" ? "s" : "a";
    if (decodeSegment(segments[0] ?? "") !== expectedPrefix || decodeSegment(segments[1] ?? "") !== pubId) return null;
    stableSegments = segments.slice(2);
    basePath = `/${expectedPrefix}/${pubId}/`;
  } else if (
    manifest.slug !== undefined &&
    decodeSegment(segments[0] ?? "") === "p" &&
    decodeSegment(segments[1] ?? "") === manifest.slug
  ) {
    stableSegments = segments.slice(2);
    basePath = `/p/${manifest.slug}/`;
  }

  return { basePath, assetSegments: withDirectoryIndex(stableSegments, hasTrailingSlash) };
}

function withDirectoryIndex(segments: readonly string[], hasTrailingSlash: boolean): readonly string[] {
  if (hasTrailingSlash && segments.length > 0) return [...segments, "index.html"];
  return segments;
}

async function authorizeViewer({
  manifest,
  request,
  env,
  deps,
}: {
  manifest: SiteEdgeManifest;
  request: Request;
  env: Env;
  deps: WorkerDeps;
}): Promise<Response | null> {
  switch (manifest.tier) {
    case "public":
    case "secret":
      return null;
    case "accounts": {
      const auth = await authenticateAccess({ request, env, deps });
      if (!auth.ok) return auth.response;
      const email = auth.email.trim().toLowerCase();
      if (!manifest.allowedEmails.includes(email)) return forbidden();
      return null;
    }
    case "any-account": {
      const auth = await authenticateAccess({ request, env, deps });
      return auth.ok ? null : auth.response;
    }
    default:
      return assertNever(manifest);
  }
}

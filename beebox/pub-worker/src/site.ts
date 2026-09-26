/** Serving for one Worker pinned to one box publication and random host handle. */

import { releaseIdSchema, type SiteEdgeManifest } from "../../src/publish/manifest-edge";
import { authenticateAccess } from "./access-auth";
import { resolveAssetPath, decodeSegment } from "./asset-path";
import { contentTypeFor } from "./content-type";
import type { WorkerDeps } from "./deps";
import type { Env } from "./env";
import { isExpired, loadManifest } from "./manifest-store";
import { forbidden, gone, methodNotAllowed, notFound } from "./responses";

const PUB_ID_RE = /^[2-7a-z]{26}$/;
const MAX_PREVIOUS_AGE_MS = 10 * 60 * 1000;

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

  const loaded = await loadManifest(identity.pubId, env);
  if (loaded === null || !("kind" in loaded)) return notFound();
  const manifest = loaded;
  if (manifest.hostHandle !== identity.hostHandle) return notFound();
  if (manifest.status === "revoked" || isExpired(manifest.expiresAt, deps.now())) return gone();
  if (manifest.status === "disabled") return gone();

  const url = new URL(request.url);
  const requested = parseSitePath({ pathname: url.pathname, pubId: identity.pubId, manifest });
  if (requested === null) return notFound();

  const access = await authorizeViewer({ manifest, request, env, deps });
  if (access !== null) return access;
  const basePath = manifest.tier === "public" ? "/" : `/${manifest.tier === "secret" ? "s" : "a"}/${identity.pubId}/`;
  return serveSiteAssets({
    request,
    env,
    deps,
    manifest,
    pubId: identity.pubId,
    basePath,
    releaseId: requested.releaseId,
    assetSegments: requested.assetSegments,
  });
}

/** Common immutable-release renderer used by pinned and shared-host Workers. */
export async function serveSiteAssets({ request, env, deps, manifest, pubId, basePath, releaseId, assetSegments }: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
  manifest: SiteEdgeManifest;
  pubId: string;
  /** Stable route prefix including its trailing slash (`/`, `/slug/`, or `/s/<id>/`). */
  basePath: string;
  releaseId: string | null;
  assetSegments: readonly string[];
}): Promise<Response> {
  const assetPath = resolveAssetPath(assetSegments);
  if (assetPath === null) return notFound();
  const active = manifest.activeRelease;
  if (releaseId === null) {
    if (!Object.prototype.hasOwnProperty.call(active.files, assetPath)) return notFound();
    return releaseRedirect({ request, basePath, releaseId: active.id, assetPath });
  }

  const release = selectRelease({ manifest, releaseId, nowMs: deps.now() });
  if (release === null || !Object.prototype.hasOwnProperty.call(release.files, assetPath)) {
    const stillListedHtml = contentTypeFor(assetPath).startsWith("text/html")
      && Object.prototype.hasOwnProperty.call(active.files, assetPath);
    if (!stillListedHtml) return notFound();
    return releaseRedirect({ request, basePath, releaseId: active.id, assetPath });
  }

  const object = await env.PUB_STORE.get(`pubs/${pubId}/releases/${release.id}/${assetPath}`);
  if (object === null) return notFound();
  const headers = new Headers({
    "Content-Type": contentTypeFor(assetPath),
    "Content-Length": String(release.files[assetPath]?.bytes ?? 0),
  });
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

function releaseRedirect({ request, basePath, releaseId, assetPath }: { request: Request; basePath: string; releaseId: string; assetPath: string }): Response {
  const encodedAsset = assetPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const target = new URL(request.url);
  target.pathname = `${prefix}/__release/${releaseId}/${encodedAsset}`;
  return Response.redirect(target.toString(), 302);
}

interface SitePath {
  releaseId: string | null;
  assetSegments: readonly string[];
}

function parseSitePath({ pathname, pubId, manifest }: { pathname: string; pubId: string; manifest: SiteEdgeManifest }): SitePath | null {
  const segments = pathname.split("/");
  segments.shift();
  const hasTrailingSlash = segments.at(-1) === "";
  if (hasTrailingSlash) segments.pop();
  if (segments.some((segment) => segment.length === 0)) return null;

  let stableSegments = segments;
  if (manifest.tier === "secret" || manifest.tier === "accounts" || manifest.tier === "any-account") {
    const expectedPrefix = manifest.tier === "secret" ? "s" : "a";
    if (decodeSegment(segments[0] ?? "") !== expectedPrefix || decodeSegment(segments[1] ?? "") !== pubId) return null;
    stableSegments = segments.slice(2);
  } else if (
    manifest.slug !== undefined &&
    decodeSegment(segments[0] ?? "") === "p" &&
    decodeSegment(segments[1] ?? "") === manifest.slug
  ) {
    stableSegments = segments.slice(2);
  }

  // `decodeSegment` intentionally rejects every `__` segment for published
  // assets; recognize this one Worker-owned route before validating assets.
  if (stableSegments[0] === "__release") {
    const releaseId = decodeSegment(stableSegments[1] ?? "");
    if (releaseId === null || !releaseIdSchema.safeParse(releaseId).success) return null;
    return { releaseId, assetSegments: withDirectoryIndex(stableSegments.slice(2), hasTrailingSlash) };
  }
  return { releaseId: null, assetSegments: withDirectoryIndex(stableSegments, hasTrailingSlash) };
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
      return null;
  }
}

function selectRelease({
  manifest,
  releaseId,
  nowMs,
}: {
  manifest: SiteEdgeManifest;
  releaseId: string;
  nowMs: number;
}) {
  if (manifest.activeRelease.id === releaseId) return manifest.activeRelease;
  const previous = manifest.previousRelease;
  if (previous === undefined || previous.id !== releaseId) return null;
  const expiresAt = Date.parse(previous.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
  if (expiresAt - nowMs > MAX_PREVIOUS_AGE_MS) return null;
  return previous;
}

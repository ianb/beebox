/**
 * pub-worker — the Cloudflare Worker that serves callback-box publications from
 * R2 (Track C of `docs/plans/publish-pages.md`).
 *
 * Request shape: `/{p|s|a}/<key>/<asset-path...>`
 *  - `/p/` public  — `<key>` is a human slug, resolved via a `slugs/<slug>` R2
 *    pointer object to a pub-id.
 *  - `/s/` secret  — `<key>` IS the pub-id (the ≥128-bit capability token).
 *  - `/a/` account — account-gated (Track D): Cloudflare Access JWT + per-pub
 *    allowlist. Fails closed to 404 when the box hasn't configured Access.
 *
 * The Worker treats its own R2 store as an untrusted boundary (principle #3 /
 * the Val Town lesson): it `safeParse`s the edge manifest on every serve and
 * fails closed — an invalid/missing manifest, a tier/URL-prefix mismatch, or an
 * unknown id is a 404; a revoked or expired publication is a 410; a bad/missing
 * Access assertion is a 401; a non-allowlisted viewer is a 403. Every response —
 * 200, 401, 403, 404, 410 — leaves through `withSecurityHeaders`.
 */

import { edgeManifestSchema, type EdgeManifest, type Tier } from "../../src/publish/manifest-edge";
import { verifyAccessAssertion, jwksFetcherFor, type GetJwks } from "./access";
import { logAccess } from "./access-log";
import { resolveAssetPath, decodeSegment } from "./asset-path";
import { contentTypeFor } from "./content-type";
import { accessConfig, type Env } from "./env";
import { assertNever } from "./exhaustive";
import { withSecurityHeaders } from "./headers";

type Prefix = "p" | "s" | "a";

/**
 * The Worker's injectable dependencies — a clock, a JWKS fetcher factory, and an
 * id generator — so tests drive the account tiers deterministically (principle
 * #10): sign assertions against a known `exp`, supply a stub JWKS with no
 * network, and assert a fixed access-log object. Production wires the real ones.
 */
export interface WorkerDeps {
  /** Current epoch-ms; threaded into Access `exp` checks and the access-log `ts`. */
  now: () => number;
  /** Builds the {@link GetJwks} for a team domain (prod: {@link jwksFetcherFor}). */
  jwksFor: (teamDomain: string) => GetJwks;
  /** Fresh id for a per-view access-log object key. */
  newId: () => string;
}

const defaultDeps: WorkerDeps = {
  now: () => Date.now(),
  jwksFor: jwksFetcherFor,
  newId: () => crypto.randomUUID(),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle({ request, env, deps: defaultDeps });
  },
} satisfies ExportedHandler<Env>;

/**
 * The full request pipeline with injectable {@link WorkerDeps}, ending at the
 * single `withSecurityHeaders` exit. Exported so tests exercise the account tiers
 * with a stub clock/JWKS/id; the default `fetch` calls it with {@link defaultDeps}.
 */
export async function handle({ request, env, deps }: { request: Request; env: Env; deps: WorkerDeps }): Promise<Response> {
  // Single exit: every response (including errors) gets the full header set.
  return withSecurityHeaders(await route({ request, env, deps }));
}

/** Route a request to a response WITHOUT security headers (the caller adds them). */
async function route({ request, env, deps }: { request: Request; env: Env; deps: WorkerDeps }): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Track F adds `POST /__submit/<id>`; nothing else is writable.
    return methodNotAllowed();
  }

  // `URL.pathname` keeps percent-encoding (so `%2e%2e` survives) but does
  // collapse a literal `/../`. Split into raw (still-encoded) segments WITHOUT
  // collapsing empties: only the always-present leading slash and a single
  // trailing slash (directory → index.html) are dropped, so an internal `//`
  // survives as an empty segment and is rejected downstream (not normalized away).
  const { pathname } = new URL(request.url);
  const rawSegments = pathname.split("/");
  rawSegments.shift(); // drop the leading "" (pathname always starts with "/")
  if (rawSegments.length > 0 && rawSegments[rawSegments.length - 1] === "") {
    rawSegments.pop(); // trailing slash → serve the directory's index.html
  }
  const [prefixSegment, keySegment, ...assetSegments] = rawSegments;

  if (prefixSegment === undefined || keySegment === undefined) return notFound();

  const prefix = asPrefix(prefixSegment);
  // Anything that isn't p/s/a — including the reserved `/__submit/` (Track F)
  // and account-route seams — is not a serve path.
  if (prefix === null) return notFound();

  const key = decodeSegment(keySegment);
  if (key === null) return notFound();

  const pubId = await resolvePubId({ prefix, key, env });
  if (pubId === null) return notFound();

  const manifest = await loadManifest(pubId, env);
  if (manifest === null) return notFound();

  // Fail-closed on a tier/URL-prefix mismatch: a mis-uploaded manifest can't
  // widen access (e.g. an `accounts` manifest reached via `/s/`).
  if (!prefixMatchesTier(prefix, manifest.tier)) return notFound();

  // Tombstone / expiry — a deliberate, distinct 410 signal (locked decision 4).
  if (manifest.status === "revoked") return gone();
  if (isExpired(manifest.expiresAt)) return gone();

  return serveByTier({ manifest, pubId, assetSegments, request, env, deps });
}

/** Exhaustive dispatch over the tier union (principle #2). */
async function serveByTier({
  manifest,
  pubId,
  assetSegments,
  request,
  env,
  deps,
}: {
  manifest: EdgeManifest;
  pubId: string;
  assetSegments: readonly string[];
  request: Request;
  env: Env;
  deps: WorkerDeps;
}): Promise<Response> {
  switch (manifest.tier) {
    case "public":
    case "secret":
      return serveAsset({ pubId, assetSegments, env });
    case "accounts": {
      // Account-gated: Access proves *who*, then the CURRENT manifest decides
      // access (Val Town lesson — identity ≠ access). The allowlist is
      // fail-closed: an absent/empty `allowedEmails` means nobody (mirrors
      // `box-access.ts` — the publisher must name viewers explicitly).
      const auth = await authenticateAccess({ request, env, deps });
      if (!auth.ok) return auth.response;
      const allowed = manifest.allowedEmails ?? [];
      if (!allowed.includes(auth.email)) return forbidden();
      return serveAsset({ pubId, assetSegments, env });
    }
    case "any-account": {
      const auth = await authenticateAccess({ request, env, deps });
      if (!auth.ok) return auth.response;
      // Any Access-verified email passes; record *who looked* (the log write
      // must never deny an authorized viewer — see `logAccess`).
      await logAccess({ env, pubId, email: auth.email, now: deps.now, newId: deps.newId });
      return serveAsset({ pubId, assetSegments, env });
    }
    default:
      return assertNever(manifest);
  }
}

/**
 * Authenticate a `/a/` request via Cloudflare Access. Returns the verified email,
 * or the fail-closed response to return unchanged:
 *  - Access NOT configured (no team domain / aud) → **404**: the box hasn't set
 *    up account tiers, so `/a/` is not a served surface here — treated like a
 *    missing surface (mirrors the tier/host-mismatch 404) rather than advertising
 *    gated content with a 401.
 *  - Missing/invalid/expired/wrong-`aud` assertion → **401**: Access should have
 *    supplied a valid assertion, so its absence means misconfig or a bypass
 *    attempt; never serve (fail-closed, principle #4).
 */
async function authenticateAccess({
  request,
  env,
  deps,
}: {
  request: Request;
  env: Env;
  deps: WorkerDeps;
}): Promise<{ ok: true; email: string } | { ok: false; response: Response }> {
  const config = accessConfig(env);
  if (config === null) return { ok: false, response: notFound() };
  const result = await verifyAccessAssertion({
    request,
    config,
    getJwks: deps.jwksFor(config.teamDomain),
    now: deps.now,
  });
  if (!result.ok) return { ok: false, response: unauthorized() };
  return { ok: true, email: result.email };
}

/** Fetch a bundle asset from R2 after validating the asset path. */
async function serveAsset({
  pubId,
  assetSegments,
  env,
}: {
  pubId: string;
  assetSegments: readonly string[];
  env: Env;
}): Promise<Response> {
  const assetPath = resolveAssetPath(assetSegments);
  // A rejected path (traversal / reserved / malformed) never becomes an R2 get,
  // so the out-of-prefix objects are unreachable, not merely 404'd after a peek.
  if (assetPath === null) return notFound();

  const key = `pubs/${pubId}/bundle/${assetPath}`;
  const object = await env.PUB_STORE.get(key);
  if (object === null) return notFound();

  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(assetPath));
  return new Response(object.body, { status: 200, headers });
}

/** Resolve the URL key to a pub-id: `/p/` via a slug pointer, `/s/`+`/a/` direct. */
async function resolvePubId({ prefix, key, env }: { prefix: Prefix; key: string; env: Env }): Promise<string | null> {
  if (prefix !== "p") return key;
  // Public tier: the key is a slug; a `slugs/<slug>` pointer object holds the
  // pub-id. A slug miss is an ordinary 404.
  const pointer = await env.PUB_STORE.get(`slugs/${key}`);
  if (pointer === null) return null;
  const pubId = (await pointer.text()).trim();
  const decoded = decodeSegment(pubId);
  if (decoded === null || decoded !== pubId) return null;
  return pubId;
}

/** Fetch + `safeParse` the edge manifest. Missing or invalid → null (+ a log). */
async function loadManifest(pubId: string, env: Env): Promise<EdgeManifest | null> {
  const object = await env.PUB_STORE.get(`pubs/${pubId}/manifest.json`);
  if (object === null) {
    console.warn(`pub-worker: no manifest for pub ${pubId}`);
    return null;
  }
  const raw = await object.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (_e) {
    console.warn(`pub-worker: manifest for pub ${pubId} is not valid JSON`);
    return null;
  }
  const parsed = edgeManifestSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`pub-worker: manifest for pub ${pubId} failed schema validation`);
    return null;
  }
  return parsed.data;
}

function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return true; // unparseable expiry → treat as expired (fail-closed)
  return at <= Date.now();
}

function prefixMatchesTier(prefix: Prefix, tier: Tier): boolean {
  switch (tier) {
    case "public":
      return prefix === "p";
    case "secret":
      return prefix === "s";
    case "accounts":
    case "any-account":
      return prefix === "a";
    default:
      return assertNever(tier);
  }
}

function asPrefix(segment: string): Prefix | null {
  return segment === "p" || segment === "s" || segment === "a" ? segment : null;
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function gone(): Response {
  return new Response("Gone", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Missing/invalid Access assertion on `/a/` — Access should have supplied one. */
function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Verified viewer, but not permitted by the current manifest (allowlist miss). */
function forbidden(): Response {
  return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" },
  });
}

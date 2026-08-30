/**
 * Cloudflare Access assertion verification (Track D of
 * `docs/plans/publish-pages.md`). Account-gated (`/a/`) publications sit behind a
 * Cloudflare Access application; Access terminates the Google IdP flow, manages
 * the visitor session, and forwards a signed identity assertion (a JWT) to the
 * Worker. This module does the ONE cryptographic thing the Worker owns: verify
 * that assertion against Cloudflare's published Access JWKS and extract the
 * verified `email`. It is NOT an OAuth flow — no IdP round-trip, no session, no
 * cookie the Worker sets. The per-publication allowlist check lives in `index.ts`.
 *
 * Fail-closed (principle #4): every failure — missing header, malformed token,
 * bad signature, wrong `aud`/`iss`, expired, or an unreachable JWKS — yields a
 * typed negative result. Nothing throws out to become a 500.
 *
 * JWKS fetching is injectable (principle #10): `verifyAccessAssertion` takes a
 * `getJwks` dependency, so tests sign tokens with a known private key and supply
 * the matching public JWKS with no network. Production wires {@link jwksFetcherFor},
 * which fetches `https://<team>/cdn-cgi/access/certs` via the Worker's own
 * server-side `fetch` (NOT constrained by the served-page CSP) and caches the key
 * set in-Worker with a short TTL, failing closed if the fetch fails.
 */

import { z } from "zod";

/** Access team domain + application `aud`, read from env (see `env.ts`). */
export interface AccessConfig {
  /** Full origin, e.g. `https://myteam.cloudflareaccess.com` — also the `iss`. */
  teamDomain: string;
  /** The Access application `aud` tag the token must be scoped to. */
  aud: string;
}

/** The verification outcome. `email` is present only on success. */
export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; reason: "no-assertion" | "invalid" | "jwks-unavailable" };

/** A single RSA verifying key from the Access JWKS. */
export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

/**
 * Supplies the current Access JWKS. Returns `null` on an unreachable/invalid key
 * set (→ fail closed). Injected in tests; {@link jwksFetcherFor} is the prod impl.
 */
export type GetJwks = () => Promise<readonly Jwk[] | null>;

/** Allowed clock skew when checking `exp`/`nbf`/`iat` (Access tokens are edge-minted). */
const CLOCK_SKEW_MS = 60_000;

/** How long a fetched key set is trusted before a refetch (Access certs rotate slowly). */
const JWKS_TTL_MS = 10 * 60_000;

const jwkSchema = z.object({ kid: z.string().min(1), kty: z.literal("RSA"), n: z.string().min(1), e: z.string().min(1) });
const jwksResponseSchema = z.object({ keys: z.array(jwkSchema) });

const jwtHeaderSchema = z.object({ alg: z.string(), kid: z.string().min(1) });
const jwtPayloadSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]),
  iss: z.string(),
  exp: z.number(),
  email: z.string().min(1),
  nbf: z.number().optional(),
  iat: z.number().optional(),
});

type JwtPayload = z.infer<typeof jwtPayloadSchema>;

/**
 * Verify the Cloudflare Access assertion on `request` and return the verified
 * email, or a typed reason it was rejected.
 */
export async function verifyAccessAssertion({
  request,
  config,
  getJwks,
  now,
}: {
  request: Request;
  config: AccessConfig;
  getJwks: GetJwks;
  now?: () => number;
}): Promise<AccessResult> {
  const nowMs = now === undefined ? Date.now() : now();

  const token = extractToken(request);
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a null check on the extracted token, not a secret comparison
  if (token === null) return { ok: false, reason: "no-assertion" };

  const parts = token.split(".");
  const [headerB64, payloadB64, signatureB64] = parts;
  // A JWS is exactly three segments; the per-segment `undefined` guard also
  // narrows the tuple for `noUncheckedIndexedAccess`.
  if (parts.length !== 3 || headerB64 === undefined || payloadB64 === undefined || signatureB64 === undefined) {
    return { ok: false, reason: "invalid" };
  }

  const header = decodeJson(headerB64, jwtHeaderSchema);
  // Only RS256 is used by Cloudflare Access; pin it (never trust the token's own
  // `alg`, e.g. an `alg: "none"` downgrade).
  if (header === null || header.alg !== "RS256") return { ok: false, reason: "invalid" };

  const payload = decodeJson(payloadB64, jwtPayloadSchema);
  if (payload === null) return { ok: false, reason: "invalid" };

  const jwks = await getJwks();
  if (jwks === null) return { ok: false, reason: "jwks-unavailable" };

  const signature = base64UrlToBytes(signatureB64);
  if (signature === null) return { ok: false, reason: "invalid" };

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureValid = await verifySignature({ jwks, kid: header.kid, signature, data: signingInput });
  if (!signatureValid) return { ok: false, reason: "invalid" };

  if (!claimsValid({ payload, config, nowMs })) return { ok: false, reason: "invalid" };

  return { ok: true, email: payload.email };
}

/** Read the assertion from the header, falling back to the `CF_Authorization` cookie. */
function extractToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header !== null && header.length > 0) return header;
  const cookie = request.headers.get("Cookie");
  if (cookie === null) return null;
  return readCookie(cookie, "CF_Authorization");
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** RS256-verify `data`/`signature` against the JWKS key whose `kid` matches. */
async function verifySignature({
  jwks,
  kid,
  signature,
  data,
}: {
  jwks: readonly Jwk[];
  kid: string;
  signature: Uint8Array;
  data: Uint8Array;
}): Promise<boolean> {
  const jwk = jwks.find((k) => k.kid === kid);
  if (jwk === undefined) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, data);
  } catch (_e) {
    // A malformed key or signature is a verification failure, not a 500.
    return false;
  }
}

function claimsValid({ payload, config, nowMs }: { payload: JwtPayload; config: AccessConfig; nowMs: number }): boolean {
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(config.aud) : payload.aud === config.aud;
  if (!audOk) return false;
  if (payload.iss !== config.teamDomain) return false;
  if (nowMs >= payload.exp * 1000 + CLOCK_SKEW_MS) return false; // expired
  if (payload.nbf !== undefined && nowMs < payload.nbf * 1000 - CLOCK_SKEW_MS) return false; // not yet valid
  if (payload.iat !== undefined && payload.iat * 1000 > nowMs + CLOCK_SKEW_MS) return false; // issued in the future
  return true;
}

function decodeJson<T>(segment: string, schema: z.ZodType<T>): T | null {
  const text = base64UrlToString(segment);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function base64UrlToBytes(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch (_e) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  // `atob` yields a binary (latin1) string: each char is one 0–255 byte, so
  // `charCodeAt` (a single UTF-16 code unit) is exactly the byte. `codePointAt`
  // would return `number | undefined` and combine surrogate pairs — wrong here.
  // eslint-disable-next-line unicorn/prefer-code-point -- decoding latin1 bytes, not code points
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToString(input: string): string | null {
  const bytes = base64UrlToBytes(input);
  if (bytes === null) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (_e) {
    return null;
  }
}

// --- Production JWKS fetcher (module-cached per team domain) -------------------

const fetchers = new Map<string, GetJwks>();

/**
 * The production {@link GetJwks} for a team domain, cached at module scope so the
 * key set persists across requests in a warm Worker. Fetches
 * `<teamDomain>/cdn-cgi/access/certs` via the Worker's server-side `fetch` and
 * caches the parsed keys for {@link JWKS_TTL_MS}; on a fetch/parse failure with no
 * still-valid cache it returns `null` (→ 401, fail-closed).
 */
export function jwksFetcherFor(teamDomain: string): GetJwks {
  const existing = fetchers.get(teamDomain);
  if (existing !== undefined) return existing;
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  let cache: { keys: readonly Jwk[]; expiresAt: number } | null = null;
  const fetcher: GetJwks = async () => {
    if (cache !== null && Date.now() < cache.expiresAt) return cache.keys;
    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (e) {
      console.warn(`pub-worker: Access JWKS fetch failed for ${teamDomain}: ${String(e)}`);
      return null;
    }
    if (!response.ok) {
      console.warn(`pub-worker: Access JWKS fetch for ${teamDomain} returned ${response.status}`);
      return null;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (_e) {
      console.warn(`pub-worker: Access JWKS for ${teamDomain} is not valid JSON`);
      return null;
    }
    const parsed = jwksResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`pub-worker: Access JWKS for ${teamDomain} failed schema validation`);
      return null;
    }
    cache = { keys: parsed.data.keys, expiresAt: Date.now() + JWKS_TTL_MS };
    return cache.keys;
  };
  fetchers.set(teamDomain, fetcher);
  return fetcher;
}

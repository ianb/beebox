/**
 * Track D — account tiers via Cloudflare Access. Exercises the `/a/` serve path
 * end to end with a real RS256 signature: an in-test keypair signs Access-style
 * assertions, the matching public JWKS is injected through the `getJwks` seam (no
 * network — principle #10), and the Worker clock + access-log id are injected so
 * `exp` checks and the logged object are deterministic.
 *
 * The suite drives {@link handle} directly (rather than `SELF.fetch`) so it can
 * supply the injected `WorkerDeps` and an Access-configured `Env`; the same R2
 * binding (`env.PUB_STORE`) backs both, so seeding via `env.PUB_STORE.put` is
 * visible to the served request.
 */
import { env } from "cloudflare:test";
import { assert, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { handle, type WorkerDeps } from "../src/index";
import type { Env } from "../src/env";
import type { Jwk } from "../src/access";

const ISS = "https://team.cloudflareaccess.com";
const AUD = "test-access-aud-tag";
const KID = "test-key-1";
const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const LOG_ID = "fixed-log-id";

const ALLOWED_EMAIL = "ada@example.com";
const OTHER_EMAIL = "grace@example.com";

const ACCT_ID = "e".repeat(26); // accounts tier, allowlist = [ALLOWED_EMAIL]
const ACCT_EMPTY_ID = "f".repeat(26); // accounts tier, no allowedEmails (nobody)
const ANY_ID = "g".repeat(26); // any-account tier

const ACCT_HTML = "<h1>account bundle</h1>";
const ANY_HTML = "<h1>any-account bundle</h1>";

const EXPECTED_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'none'",
};

/** The assertion header value on a request: a signed token, or absent. */
type AssertionHeader = string | null;

interface Claims {
  aud: string | string[];
  iss: string;
  email: string;
  exp: number;
  iat: number;
}

interface SignOptions {
  alg: string;
  kid: string;
}

interface ServeOptions {
  env: Env;
  deps: WorkerDeps;
}

function assertSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(res.headers.get(name), `header ${name}`).toBe(value);
  }
}

function fileEntry(bytes: number): { bytes: number; sha256: string } {
  return { bytes, sha256: "0".repeat(64) };
}

let privateKey: CryptoKey;
let publicJwk: Jwk;

beforeAll(async () => {
  const generated = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  assert("privateKey" in generated, "expected generateKey to return an RSA key pair");
  privateKey = generated.privateKey;
  const exported = await crypto.subtle.exportKey("jwk", generated.publicKey);
  assert(!(exported instanceof ArrayBuffer), "expected a JWK-format public key export");
  const n = exported.n;
  const e = exported.e;
  assert(n !== undefined && e !== undefined, "exported public JWK is missing a required RSA field");
  publicJwk = { kid: KID, kty: "RSA", n, e };
});

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCodePoint(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function validClaims(overrides?: Partial<Claims>): Claims {
  return { aud: AUD, iss: ISS, email: ALLOWED_EMAIL, exp: NOW_S + 3600, iat: NOW_S - 60, ...overrides };
}

/** Sign an Access-style assertion with the in-test private key (default RS256). */
async function signAssertion(claims: Claims, overrides?: Partial<SignOptions>): Promise<string> {
  const opts: SignOptions = { alg: "RS256", kid: KID, ...overrides };
  const signingInput = `${jsonToBase64Url({ alg: opts.alg, kid: opts.kid, typ: "JWT" })}.${jsonToBase64Url(claims)}`;
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

function makeDeps(overrides?: Partial<WorkerDeps>): WorkerDeps {
  return {
    now: () => NOW_MS,
    jwksFor: () => () => Promise.resolve([publicJwk]),
    newId: () => LOG_ID,
    ...overrides,
  };
}

function configuredEnv(): Env {
  return { ...env, ACCESS_TEAM_DOMAIN: ISS, ACCESS_AUD: AUD };
}

function accessRequest(path: string, assertionHeader: AssertionHeader): Request {
  const headers = new Headers();
  if (assertionHeader !== null) headers.set("Cf-Access-Jwt-Assertion", assertionHeader);
  return new Request(`https://pub.example.com${path}`, { headers });
}

function serve(path: string, assertionHeader: AssertionHeader, overrides?: Partial<ServeOptions>): Promise<Response> {
  const opts: ServeOptions = { env: configuredEnv(), deps: makeDeps(), ...overrides };
  return handle({ request: accessRequest(path, assertionHeader), env: opts.env, deps: opts.deps });
}

beforeEach(async () => {
  await env.PUB_STORE.put(
    `pubs/${ACCT_ID}/manifest.json`,
    JSON.stringify({
      tier: "accounts",
      allowedEmails: [ALLOWED_EMAIL],
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(ACCT_HTML.length) },
    }),
  );
  await env.PUB_STORE.put(`pubs/${ACCT_ID}/bundle/index.html`, ACCT_HTML);

  // accounts tier with NO allowedEmails — parses fine, but means nobody.
  await env.PUB_STORE.put(
    `pubs/${ACCT_EMPTY_ID}/manifest.json`,
    JSON.stringify({
      tier: "accounts",
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(ACCT_HTML.length) },
    }),
  );
  await env.PUB_STORE.put(`pubs/${ACCT_EMPTY_ID}/bundle/index.html`, ACCT_HTML);

  await env.PUB_STORE.put(
    `pubs/${ANY_ID}/manifest.json`,
    JSON.stringify({
      tier: "any-account",
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(ANY_HTML.length) },
    }),
  );
  await env.PUB_STORE.put(`pubs/${ANY_ID}/bundle/index.html`, ANY_HTML);
});

describe("accounts tier — allowlist gating", () => {
  it("serves the bundle for an allowlisted email with a valid assertion (200 + headers)", async () => {
    const res = await serve(`/a/${ACCT_ID}/index.html`, await signAssertion(validClaims()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(ACCT_HTML);
    assertSecurityHeaders(res);
  });

  it("403s a valid assertion whose email is not in the allowlist", async () => {
    const res = await serve(`/a/${ACCT_ID}/index.html`, await signAssertion(validClaims({ email: OTHER_EMAIL })));
    expect(res.status).toBe(403);
    assertSecurityHeaders(res);
  });

  it("403s everyone when allowedEmails is absent/empty (fail-closed = nobody)", async () => {
    const res = await serve(`/a/${ACCT_EMPTY_ID}/index.html`, await signAssertion(validClaims()));
    expect(res.status).toBe(403);
    assertSecurityHeaders(res);
  });
});

describe("account tiers — assertion rejection is always 401 (never serve)", () => {
  it("401s a missing assertion", async () => {
    const res = await serve(`/a/${ACCT_ID}/index.html`, null);
    expect(res.status).toBe(401);
    assertSecurityHeaders(res);
  });

  it("401s an expired assertion", async () => {
    const res = await serve(`/a/${ACCT_ID}/index.html`, await signAssertion(validClaims({ exp: NOW_S - 3600, iat: NOW_S - 7200 })));
    expect(res.status).toBe(401);
  });

  it("401s an assertion with the wrong aud", async () => {
    const res = await serve(`/a/${ACCT_ID}/index.html`, await signAssertion(validClaims({ aud: "some-other-aud" })));
    expect(res.status).toBe(401);
  });

  it("401s a tampered signature", async () => {
    const [header, payload, sig] = (await signAssertion(validClaims())).split(".");
    assert(header !== undefined && payload !== undefined && sig !== undefined, "signed token should have three segments");
    // Flip the FIRST signature char (its top 6 bits are always significant —
    // flipping the last char lands in padding bits for a 256-byte signature and
    // decodes to the same bytes).
    const tampered = `${header}.${payload}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
    const res = await serve(`/a/${ACCT_ID}/index.html`, tampered);
    expect(res.status).toBe(401);
  });

  it("401s an alg:none token (no RS256 downgrade)", async () => {
    const header = jsonToBase64Url({ alg: "none", kid: KID, typ: "JWT" });
    const payload = jsonToBase64Url(validClaims());
    const res = await serve(`/a/${ACCT_ID}/index.html`, `${header}.${payload}.`);
    expect(res.status).toBe(401);
  });
});

describe("any-account tier — any verified email, view logged", () => {
  it("serves any valid email and writes a per-view access-log object", async () => {
    const res = await serve(`/a/${ANY_ID}/index.html`, await signAssertion(validClaims({ email: OTHER_EMAIL })));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ANY_HTML);
    assertSecurityHeaders(res);

    const logObject = await env.PUB_STORE.get(`access-log/${ANY_ID}/${LOG_ID}.json`);
    assert(logObject !== null, "expected an access-log object to be written for the any-account view");
    const entry: unknown = JSON.parse(await logObject.text());
    const parsed = z.object({ ts: z.string(), pubId: z.string(), email: z.string() }).parse(entry);
    expect(parsed).toEqual({ ts: new Date(NOW_MS).toISOString(), pubId: ANY_ID, email: OTHER_EMAIL });
  });
});

describe("account tiers unconfigured — fail closed to 404", () => {
  it("404s /a/ when Access is not configured (empty team domain / aud)", async () => {
    // Chosen fail-closed status: 404 (not 401). With no Access config the box has
    // not set up account tiers, so `/a/` is not a served surface here — treat it
    // like a missing surface rather than advertising gated content with a 401.
    const res = await serve(`/a/${ACCT_ID}/index.html`, await signAssertion(validClaims()), {
      env: { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
    });
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });
});

/**
 * Account tiers via Cloudflare Access, through the pinned-site serve path.
 * Exercises `accounts` and `any-account` site manifests end to end with a real
 * RS256 signature: an in-test keypair signs Access-style assertions, the
 * matching public JWKS is injected through the `getJwks` seam (no network —
 * principle #10), and the Worker clock is injected so `exp` checks are
 * deterministic.
 *
 * The suite drives {@link handle} directly (rather than `SELF.fetch`) so it can
 * supply the injected `WorkerDeps` and an Access-configured `Env`; the same R2
 * binding backs both, so seeding through `env` is visible to the served request.
 */
import { env } from "cloudflare:test";
import { assert, beforeAll, describe, expect, it } from "vitest";
import { releaseIdForFiles, siteEdgeManifestSchema } from "../../src/publish/manifest-edge";
import { handle, type WorkerDeps } from "../src/worker";
import type { Env } from "../src/env";
import type { Jwk } from "../src/access";

const ISS = "https://team.cloudflareaccess.com";
const AUD = "test-access-aud-tag";
const KID = "test-key-1";
const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

const ALLOWED_EMAIL = "ada@example.com";
const OTHER_EMAIL = "grace@example.com";

const SITE_ID = "e".repeat(26);
const HOST_HANDLE = "account-site-host";
const SITE_HTML = "<h1>account bundle</h1>";

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
    ...overrides,
  };
}

function configuredEnv(): Env {
  return {
    PUB_STORE: env.PUB_STORE,
    ACCESS_TEAM_DOMAIN: ISS,
    ACCESS_AUD: AUD,
    PUB_WORKER_VERSION: undefined,
    PUB_ID: SITE_ID,
    HOST_HANDLE,
  };
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

type AccountAudience = { tier: "accounts"; allowedEmails: string[] } | { tier: "any-account" };

/** Seed one account-tier site release for the pinned Worker. */
async function seedSite(audience: AccountAudience): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SITE_HTML));
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const files = { "index.html": { bytes: new TextEncoder().encode(SITE_HTML).byteLength, sha256 } };
  const releaseId = await releaseIdForFiles(files);
  const manifest = siteEdgeManifestSchema.parse({
    kind: "site",
    hostHandle: HOST_HANDLE,
    status: "live",
    expiresAt: null,
    activeRelease: { id: releaseId, files },
    ...audience,
  });
  await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify(manifest));
  await env.PUB_STORE.put(`pubs/${SITE_ID}/releases/${releaseId}/index.html`, SITE_HTML);
}

const SITE_PATH = `/a/${SITE_ID}/index.html`;

describe("accounts tier — allowlist gating", () => {
  it("serves the release for an allowlisted email with a valid assertion", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(SITE_HTML);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("matches the allowlist case-insensitively against the verified email", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims({ email: ALLOWED_EMAIL.toUpperCase() })));
    expect(res.status).toBe(200);
  });

  it("403s a valid assertion whose email is not in the allowlist", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims({ email: OTHER_EMAIL })));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("account tiers — assertion rejection is always 401 (never serve)", () => {
  it("401s a missing assertion", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("401s an expired assertion", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims({ exp: NOW_S - 3600, iat: NOW_S - 7200 })));
    expect(res.status).toBe(401);
  });

  it("401s an assertion with the wrong aud", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims({ aud: "some-other-aud" })));
    expect(res.status).toBe(401);
  });

  it("401s a tampered signature", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const [header, payload, sig] = (await signAssertion(validClaims())).split(".");
    assert(header !== undefined && payload !== undefined && sig !== undefined, "signed token should have three segments");
    // Flip the FIRST signature char (its top 6 bits are always significant —
    // flipping the last char lands in padding bits for a 256-byte signature and
    // decodes to the same bytes).
    const tampered = `${header}.${payload}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
    const res = await serve(SITE_PATH, tampered);
    expect(res.status).toBe(401);
  });

  it("401s an alg:none token (no RS256 downgrade)", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const header = jsonToBase64Url({ alg: "none", kid: KID, typ: "JWT" });
    const payload = jsonToBase64Url(validClaims());
    const res = await serve(SITE_PATH, `${header}.${payload}.`);
    expect(res.status).toBe(401);
  });

  it("401s when the JWKS is unreachable", async () => {
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims()), { deps: makeDeps({ jwksFor: () => () => Promise.resolve(null) }) });
    expect(res.status).toBe(401);
  });
});

describe("any-account tier — any verified email", () => {
  it("serves any valid email", async () => {
    await seedSite({ tier: "any-account" });
    const res = await serve(SITE_PATH, await signAssertion(validClaims({ email: OTHER_EMAIL })));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SITE_HTML);
  });

  it("401s a missing assertion", async () => {
    await seedSite({ tier: "any-account" });
    expect((await serve(SITE_PATH, null)).status).toBe(401);
  });
});

describe("account tiers unconfigured — fail closed to 404", () => {
  it("404s account-tier content when Access is not configured (empty team domain / aud)", async () => {
    // With no Access config the box has not set up account tiers, so the gated
    // surface is not served here — treat it like a missing surface rather than
    // advertising gated content with a 401.
    await seedSite({ tier: "accounts", allowedEmails: [ALLOWED_EMAIL] });
    const res = await serve(SITE_PATH, await signAssertion(validClaims()), {
      env: { ...configuredEnv(), ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

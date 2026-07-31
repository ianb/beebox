/**
 * Track F — the `POST /__submit/<pub-id>` drop-box endpoint. Exercises the full
 * fail-closed pipeline under @cloudflare/vitest-pool-workers with real
 * (miniflare-backed) R2 bindings — manifests seeded into PUB_STORE, submissions
 * written to PUB_INGEST (the content/ingestion split, Codex cross-review
 * amendment 1): content-type + size gates, the twice-enforced
 * no-public-submit refusal (proven even when the store lies), tier-by-tier
 * submitter identity (anonymous `secret`, Access-gated account tiers), field
 * validation, the best-effort daily cap, and the optional per-IP rate limiter.
 *
 * Drives {@link handle} directly (like access.test.ts) so the injected
 * `WorkerDeps` make the written submission's id/ts deterministic, and account
 * tiers can be signed against a known RS256 key with no network.
 */
import { env } from "cloudflare:test";
import { assert, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handle, type WorkerDeps } from "../src/index";
import { submissionSchema } from "../../src/publish/submission";
import type { Env, RateLimiter } from "../src/env";
import type { Jwk } from "../src/access";

const ISS = "https://team.cloudflareaccess.com";
const AUD = "test-access-aud-tag";
const KID = "test-key-1";
const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const SUB_ID = "fixed-submission-id";

const ALLOWED_EMAIL = "ada@example.com";
const OTHER_EMAIL = "grace@example.com";

const SECRET_ID = "a".repeat(26); // secret tier + submit block
const PUBLIC_ID = "b".repeat(26); // valid public manifest (parses; the Worker still refuses submit)
const PUBLIC_LIE_ID = "i".repeat(26); // ILLEGITIMATE public manifest carrying a submit block
const NOSUBMIT_ID = "c".repeat(26); // secret tier, no submit block
const REVOKED_ID = "d".repeat(26); // secret + submit, revoked
const EXPIRED_ID = "e".repeat(26); // secret + submit, past expiresAt
const SMALL_ID = "f".repeat(26); // secret + submit, tiny maxSubmissionBytes
const CAP_ID = "g".repeat(26); // secret + submit, maxPerDay = 2
const ACCT_ID = "h".repeat(26); // accounts tier + submit, allowlist = [ALLOWED_EMAIL]

const URLENCODED = "application/x-www-form-urlencoded";

const EXPECTED_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'none'",
};

function assertSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(res.headers.get(name), `header ${name}`).toBe(value);
  }
}

function fileEntry(bytes: number): { bytes: number; sha256: string } {
  return { bytes, sha256: "0".repeat(64) };
}

/** The submit block reused across the secret/account fixtures. */
function submitBlock(overrides?: { maxSubmissionBytes?: number; maxPerDay?: number }): unknown {
  const maxSubmissionBytes = overrides?.maxSubmissionBytes === undefined ? 8192 : overrides.maxSubmissionBytes;
  const maxPerDay = overrides?.maxPerDay === undefined ? 5 : overrides.maxPerDay;
  return {
    fields: [
      { name: "email", kind: "email", required: true, maxLength: 100 },
      { name: "message", kind: "textarea", required: true, maxLength: 2000 },
      { name: "topic", kind: "choice", required: false, maxLength: 50, choices: ["bug", "idea"] },
    ],
    maxSubmissionBytes,
    maxPerDay,
  };
}

const VALID_BODY = "email=ada%40example.com&message=hello+there&topic=bug";

// --- RS256 signing (mirrors access.test.ts) -----------------------------------

interface Claims {
  aud: string | string[];
  iss: string;
  email: string;
  exp: number;
  iat: number;
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

async function signAssertion(claims: Claims): Promise<string> {
  const signingInput = `${jsonToBase64Url({ alg: "RS256", kid: KID, typ: "JWT" })}.${jsonToBase64Url(claims)}`;
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

// --- Request + deps helpers ---------------------------------------------------

function makeDeps(overrides?: Partial<WorkerDeps>): WorkerDeps {
  return {
    now: () => NOW_MS,
    jwksFor: () => () => Promise.resolve([publicJwk]),
    newId: () => SUB_ID,
    ...overrides,
  };
}

function configuredEnv(overrides?: Partial<Env>): Env {
  return { ...env, ACCESS_TEAM_DOMAIN: ISS, ACCESS_AUD: AUD, ...overrides };
}

function submitRequest(
  pubId: string,
  init?: { body?: BodyInit; contentType?: string; assertion?: string; contentLength?: string },
): Request {
  const headers = new Headers();
  headers.set("Content-Type", init?.contentType === undefined ? URLENCODED : init.contentType);
  if (init?.assertion !== undefined) headers.set("Cf-Access-Jwt-Assertion", init.assertion);
  if (init?.contentLength !== undefined) headers.set("Content-Length", init.contentLength);
  return new Request(`https://pub.example.com/__submit/${pubId}`, {
    method: "POST",
    headers,
    body: init?.body === undefined ? VALID_BODY : init.body,
  });
}

function runSubmit(request: Request, opts?: { env?: Env; deps?: WorkerDeps }): Promise<Response> {
  const useEnv = opts?.env === undefined ? configuredEnv() : opts.env;
  const useDeps = opts?.deps === undefined ? makeDeps() : opts.deps;
  return handle({ request, env: useEnv, deps: useDeps });
}

async function seed(pubId: string, manifest: Record<string, unknown>): Promise<void> {
  await env.PUB_STORE.put(`pubs/${pubId}/manifest.json`, JSON.stringify(manifest));
}

beforeEach(async () => {
  await seed(SECRET_ID, { tier: "secret", status: "live", expiresAt: null, submit: submitBlock(), files: {} });
  // A legitimately-parsing public manifest (no submit — public + submit is
  // zod-unrepresentable, Track A). The Worker still independently refuses submit.
  await seed(PUBLIC_ID, { tier: "public", slug: "pub", status: "live", expiresAt: null, files: {} });
  // An illegitimate public manifest that claims a submit block — the store lying.
  // Track A's strict edge schema rejects it on parse, so it never even reaches the
  // tier gate: a distinct, second fail-closed layer (404, manifest treated missing).
  await seed(PUBLIC_LIE_ID, {
    tier: "public",
    slug: "leak",
    status: "live",
    expiresAt: null,
    submit: submitBlock(),
    files: {},
  });
  await seed(NOSUBMIT_ID, { tier: "secret", status: "live", expiresAt: null, files: {} });
  await seed(REVOKED_ID, { tier: "secret", status: "revoked", expiresAt: null, submit: submitBlock(), files: {} });
  await seed(EXPIRED_ID, {
    tier: "secret",
    status: "live",
    expiresAt: "2000-01-01T00:00:00Z",
    submit: submitBlock(),
    files: {},
  });
  await seed(SMALL_ID, {
    tier: "secret",
    status: "live",
    expiresAt: null,
    submit: submitBlock({ maxSubmissionBytes: 5 }),
    files: {},
  });
  await seed(CAP_ID, {
    tier: "secret",
    status: "live",
    expiresAt: null,
    submit: submitBlock({ maxPerDay: 2 }),
    files: {},
  });
  await seed(ACCT_ID, {
    tier: "accounts",
    allowedEmails: [ALLOWED_EMAIL],
    status: "live",
    expiresAt: null,
    submit: submitBlock(),
    files: {},
  });
});

describe("secret tier — anonymous submit", () => {
  it("accepts a valid urlencoded POST, writes the submission, returns the thank-you page (200)", async () => {
    const res = await runSubmit(submitRequest(SECRET_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("received");
    assertSecurityHeaders(res);

    const object = await env.PUB_INGEST.get(`submissions/${SECRET_ID}/${SUB_ID}.json`);
    assert(object !== null, "expected a submission object to be written");
    const parsed = submissionSchema.parse(JSON.parse(await object.text()));
    expect(parsed).toEqual({
      id: SUB_ID,
      ts: new Date(NOW_MS).toISOString(),
      pubId: SECRET_ID,
      fields: { email: "ada@example.com", message: "hello there", topic: "bug" },
      viewer: null,
      country: null,
    });
  });
});

describe("twice-enforced no-public-submit (the store can lie)", () => {
  it("403s submit to a valid public manifest — the Worker's independent tier gate", async () => {
    const res = await runSubmit(submitRequest(PUBLIC_ID));
    expect(res.status).toBe(403);
    assertSecurityHeaders(res);
    // Nothing was written.
    expect(await env.PUB_INGEST.get(`submissions/${PUBLIC_ID}/${SUB_ID}.json`)).toBe(null);
  });

  it("404s a public manifest that illegitimately claims a submit block (schema rejects the lie)", async () => {
    const res = await runSubmit(submitRequest(PUBLIC_LIE_ID));
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });

  it("403s a manifest with no submit block", async () => {
    const res = await runSubmit(submitRequest(NOSUBMIT_ID));
    expect(res.status).toBe(403);
    assertSecurityHeaders(res);
  });
});

describe("lifecycle — tombstone + expiry kill submit in the same read as pages", () => {
  it("410s a revoked publication", async () => {
    const res = await runSubmit(submitRequest(REVOKED_ID));
    expect(res.status).toBe(410);
    assertSecurityHeaders(res);
  });

  it("410s a publication past its expiresAt", async () => {
    const res = await runSubmit(submitRequest(EXPIRED_ID));
    expect(res.status).toBe(410);
  });

  it("404s an unknown pub-id", async () => {
    const res = await runSubmit(submitRequest("z".repeat(26)));
    expect(res.status).toBe(404);
  });
});

describe("request gates", () => {
  it("415s a non-urlencoded content type", async () => {
    const res = await runSubmit(submitRequest(SECRET_ID, { contentType: "application/json", body: "{}" }));
    expect(res.status).toBe(415);
    assertSecurityHeaders(res);
  });

  it("413s a body over the hard pre-parse ceiling", async () => {
    const huge = `message=${"a".repeat(1024 * 1024 + 16)}`;
    const res = await runSubmit(submitRequest(SECRET_ID, { body: huge }));
    expect(res.status).toBe(413);
  });

  it("413s a body over the manifest's maxSubmissionBytes", async () => {
    const res = await runSubmit(submitRequest(SMALL_ID));
    expect(res.status).toBe(413);
  });
});

describe("field validation → 400 (body names the offending field)", () => {
  it("400s a missing required field", async () => {
    const res = await runSubmit(submitRequest(SECRET_ID, { body: "email=ada%40example.com" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("message");
    assertSecurityHeaders(res);
  });

  it("400s a choice value not in the allowed set", async () => {
    const res = await runSubmit(submitRequest(SECRET_ID, { body: "email=ada%40example.com&message=hi&topic=nope" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("topic");
  });

  it("400s an overlong value", async () => {
    const long = "a".repeat(2001);
    const res = await runSubmit(submitRequest(SECRET_ID, { body: `email=ada%40example.com&message=${long}` }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("message");
  });

  it("400s a malformed email", async () => {
    const res = await runSubmit(submitRequest(SECRET_ID, { body: "email=not-an-email&message=hi" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("email");
  });
});

describe("best-effort daily cap → 429", () => {
  it("429s once today's submissions reach maxPerDay", async () => {
    // Pre-seed maxPerDay (2) objects uploaded now; the cap counts today's objects
    // by their R2 upload time, so align deps.now() with the real upload clock.
    await env.PUB_INGEST.put(`submissions/${CAP_ID}/one.json`, "{}");
    await env.PUB_INGEST.put(`submissions/${CAP_ID}/two.json`, "{}");
    const res = await runSubmit(submitRequest(CAP_ID), { deps: makeDeps({ now: () => Date.now() }) });
    expect(res.status).toBe(429);
    assertSecurityHeaders(res);
  });
});

describe("per-IP rate limiter (optional binding)", () => {
  it("429s when the injected limiter denies the request", async () => {
    const limiter: RateLimiter = { limit: () => Promise.resolve({ success: false }) };
    const res = await runSubmit(submitRequest(SECRET_ID), { env: configuredEnv({ SUBMIT_RATE_LIMITER: limiter }) });
    expect(res.status).toBe(429);
  });

  it("accepts when the injected limiter allows the request", async () => {
    const limiter: RateLimiter = { limit: () => Promise.resolve({ success: true }) };
    const res = await runSubmit(submitRequest(SECRET_ID), { env: configuredEnv({ SUBMIT_RATE_LIMITER: limiter }) });
    expect(res.status).toBe(200);
  });
});

describe("account tier — Access-gated submitter identity", () => {
  it("401s when no Access assertion is presented", async () => {
    const res = await runSubmit(submitRequest(ACCT_ID));
    expect(res.status).toBe(401);
    assertSecurityHeaders(res);
  });

  it("200s an allowlisted email and attaches it as the viewer", async () => {
    const res = await runSubmit(submitRequest(ACCT_ID, { assertion: await signAssertion(validClaims()) }));
    expect(res.status).toBe(200);

    const object = await env.PUB_INGEST.get(`submissions/${ACCT_ID}/${SUB_ID}.json`);
    assert(object !== null, "expected a submission object to be written");
    const parsed = submissionSchema.parse(JSON.parse(await object.text()));
    expect(parsed.viewer).toBe(ALLOWED_EMAIL);
  });

  it("403s a valid assertion whose email is not in the allowlist", async () => {
    const res = await runSubmit(submitRequest(ACCT_ID, { assertion: await signAssertion(validClaims({ email: OTHER_EMAIL })) }));
    expect(res.status).toBe(403);
    assertSecurityHeaders(res);
  });
});

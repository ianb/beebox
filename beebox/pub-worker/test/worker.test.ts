/**
 * The pub-worker serving contract (Track C) under @cloudflare/vitest-pool-workers
 * with a real (miniflare-backed) R2 binding. This suite IS the feature's edge
 * contract — the Failure-modes rows the plan enumerates: the full header set on
 * every response class, secret + public serving, tombstone-on-next-request,
 * expiry, tier/prefix mismatch, invalid manifest, and serve-time traversal in
 * every form.
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handle, type WorkerDeps } from "../src/index";

const SECRET_ID = "a".repeat(26);
const PUBLIC_ID = "b".repeat(26);
const ACCOUNT_ID = "c".repeat(26);
const UNSEEDED_ID = "d".repeat(26);
const SLUG = "build-journal";

const SECRET_HTML = "<h1>secret publication</h1>";
const PUBLIC_HTML = "<h1>public publication</h1>";
const SECRET_CSS = "body { color: rebeccapurple; }";
const SUBMISSION_SENTINEL = "TOP-SECRET-SUBMISSION-BODY";

const EXPECTED_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'none'",
};

function fileEntry(bytes: number): { bytes: number; sha256: string } {
  return { bytes, sha256: "0".repeat(64) };
}

async function put(key: string, value: string): Promise<void> {
  await env.PUB_STORE.put(key, value);
}

function get(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://pub.example.com${path}`, init);
}

function assertSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(res.headers.get(name), `header ${name}`).toBe(value);
  }
}

beforeEach(async () => {
  // Secret-tier pub with two bundle assets.
  await put(
    `pubs/${SECRET_ID}/manifest.json`,
    JSON.stringify({
      tier: "secret",
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(SECRET_HTML.length), "app.css": fileEntry(SECRET_CSS.length) },
    }),
  );
  await put(`pubs/${SECRET_ID}/bundle/index.html`, SECRET_HTML);
  await put(`pubs/${SECRET_ID}/bundle/app.css`, SECRET_CSS);

  // Public-tier pub reached via a slug pointer.
  await put(
    `pubs/${PUBLIC_ID}/manifest.json`,
    JSON.stringify({
      tier: "public",
      slug: SLUG,
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(PUBLIC_HTML.length) },
    }),
  );
  await put(`pubs/${PUBLIC_ID}/bundle/index.html`, PUBLIC_HTML);
  await put(`slugs/${SLUG}`, PUBLIC_ID);

  // Account-tier pub (served only once Track D lands + the flag flips).
  await put(
    `pubs/${ACCOUNT_ID}/manifest.json`,
    JSON.stringify({
      tier: "accounts",
      allowedEmails: ["ada@example.com"],
      status: "live",
      expiresAt: null,
      files: { "index.html": fileEntry(10) },
    }),
  );
  await put(`pubs/${ACCOUNT_ID}/bundle/index.html`, "<h1>account</h1>");

  // Out-of-prefix sentinels a traversal must never reach.
  await put(`submissions/${SECRET_ID}/x.json`, SUBMISSION_SENTINEL);
});

describe("secret tier", () => {
  it("serves the bundle bytes with content-type + the full header set (200)", async () => {
    const res = await get(`/s/${SECRET_ID}/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(SECRET_HTML);
    assertSecurityHeaders(res);
  });

  it("defaults a missing asset path to index.html", async () => {
    const res = await get(`/s/${SECRET_ID}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SECRET_HTML);
  });

  it("maps content-type by extension", async () => {
    const res = await get(`/s/${SECRET_ID}/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await res.text()).toBe(SECRET_CSS);
  });
});

describe("public tier", () => {
  it("resolves the slug via the slugs/<slug> pointer object", async () => {
    const res = await get(`/p/${SLUG}/index.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PUBLIC_HTML);
    assertSecurityHeaders(res);
  });

  it("404s an unknown slug", async () => {
    const res = await get(`/p/no-such-slug/index.html`);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });
});

describe("not found", () => {
  it("404s an unknown pub-id with the full header set (404)", async () => {
    const res = await get(`/s/${UNSEEDED_ID}/index.html`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
    assertSecurityHeaders(res);
  });

  it("404s an existing pub's missing asset", async () => {
    const res = await get(`/s/${SECRET_ID}/nope.html`);
    expect(res.status).toBe(404);
  });
});

describe("tombstone + expiry (410)", () => {
  it("takes a revocation tombstone into effect on the next request", async () => {
    const before = await get(`/s/${SECRET_ID}/index.html`);
    expect(before.status).toBe(200);

    // Overwrite the manifest with a tombstone — the R2 strong-consistency
    // guarantee the plan leans on: the next read sees it.
    await put(
      `pubs/${SECRET_ID}/manifest.json`,
      JSON.stringify({
        tier: "secret",
        status: "revoked",
        expiresAt: null,
        files: { "index.html": fileEntry(SECRET_HTML.length) },
      }),
    );

    const after = await get(`/s/${SECRET_ID}/index.html`);
    expect(after.status).toBe(410);
    expect(await after.text()).toBe("Gone");
    assertSecurityHeaders(after);
  });

  it("410s a publication past its expiresAt", async () => {
    await put(
      `pubs/${SECRET_ID}/manifest.json`,
      JSON.stringify({
        tier: "secret",
        status: "live",
        expiresAt: "2000-01-01T00:00:00Z",
        files: { "index.html": fileEntry(SECRET_HTML.length) },
      }),
    );
    const res = await get(`/s/${SECRET_ID}/index.html`);
    expect(res.status).toBe(410);
    assertSecurityHeaders(res);
  });
});

describe("tier / prefix fail-closed", () => {
  it("404s an accounts manifest requested via /s/", async () => {
    const res = await get(`/s/${ACCOUNT_ID}/index.html`);
    expect(res.status).toBe(404);
  });

  it("404s a secret manifest requested via /a/", async () => {
    const res = await get(`/a/${SECRET_ID}/index.html`);
    expect(res.status).toBe(404);
  });

  it("404s an account-tier pub via /a/ when Access is unconfigured", async () => {
    // ACCESS_TEAM_DOMAIN/ACCESS_AUD are empty placeholders in wrangler.jsonc, so
    // `accessConfig` is null → account tiers fail closed (Track D). Prefix + tier
    // match, but with no Access config the `/a/` surface 404s (not-configured).
    // (Access-configured behaviour is covered in access.test.ts.)
    const res = await get(`/a/${ACCOUNT_ID}/index.html`);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });
});

describe("invalid manifest → 404, never 500", () => {
  it("404s a manifest that is not valid JSON", async () => {
    await put(`pubs/${SECRET_ID}/manifest.json`, "{ this is not json");
    const res = await get(`/s/${SECRET_ID}/index.html`);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });

  it("404s a manifest that fails schema validation", async () => {
    await put(`pubs/${SECRET_ID}/manifest.json`, JSON.stringify({ tier: "bogus", status: "live" }));
    const res = await get(`/s/${SECRET_ID}/index.html`);
    expect(res.status).toBe(404);
  });
});

describe("serve-time traversal — every form 404s and never returns the target", () => {
  const cases: Array<{ name: string; path: string }> = [
    { name: "encoded ..", path: `/s/${SECRET_ID}/%2e%2e` },
    { name: "..%2f to reach the manifest", path: `/s/${SECRET_ID}/..%2fmanifest.json` },
    { name: "plain ../ (URL-normalized away, still 404)", path: `/s/${SECRET_ID}/../manifest.json` },
    { name: "..%2f..%2f to reach submissions", path: `/s/${SECRET_ID}/..%2f..%2fsubmissions%2f${SECRET_ID}%2fx.json` },
    { name: "leading/double slash (empty segment)", path: `/s/${SECRET_ID}//index.html` },
    { name: "encoded backslash", path: `/s/${SECRET_ID}/..%5cmanifest.json` },
    { name: "reserved __ prefix", path: `/s/${SECRET_ID}/__proto__` },
  ];

  for (const { name, path } of cases) {
    it(`rejects ${name}`, async () => {
      const res = await get(path);
      expect(res.status).toBe(404);
      const body = await res.text();
      // The out-of-prefix object is never served: body is our 404 text, not the
      // manifest JSON nor the submission sentinel.
      expect(body).toBe("Not Found");
      expect(body).not.toContain("\"tier\"");
      expect(body).not.toContain(SUBMISSION_SENTINEL);
    });
  }
});

describe("method + reserved paths", () => {
  it("405s a non-GET method", async () => {
    const res = await get(`/s/${SECRET_ID}/index.html`, { method: "POST" });
    expect(res.status).toBe(405);
    assertSecurityHeaders(res);
  });

  it("404s the reserved /__submit/ seam (Track F)", async () => {
    const res = await get(`/__submit/${SECRET_ID}`);
    expect(res.status).toBe(404);
  });
});

describe("version probe (Track E drift detection)", () => {
  it("serves 'unversioned' with the full header set when the deploy stamp is empty", async () => {
    // wrangler.jsonc commits an empty PUB_WORKER_VERSION placeholder; only a
    // real `bbx pub setup` deploy injects the hash.
    const res = await get("/__version");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("unversioned");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    assertSecurityHeaders(res);
  });

  it("echoes the deploy-stamped version var", async () => {
    const stamped = { ...env, PUB_WORKER_VERSION: "abc123deadbeef00" };
    const deps: WorkerDeps = {
      now: () => Date.now(),
      // Never called on the version path — an empty JWKS satisfies the type.
      jwksFor: () => () => Promise.resolve([]),
      newId: () => "unused",
    };
    const res = await handle({ request: new Request("https://pub.example.com/__version"), env: stamped, deps });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123deadbeef00");
    assertSecurityHeaders(res);
  });

  it("405s a POST to /__version (only submit may POST)", async () => {
    const res = await get("/__version", { method: "POST" });
    expect(res.status).toBe(405);
    assertSecurityHeaders(res);
  });
});

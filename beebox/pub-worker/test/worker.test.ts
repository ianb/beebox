/**
 * The pub-worker edge contract shared by both serving modes, exercised through
 * the pinned-site mode with a real (miniflare-backed) R2 binding: the full
 * header set on every response class, fail-closed handling of a Worker with no
 * publication bindings, expiry, invalid manifests, and serve-time traversal in
 * every form.
 */
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { releaseIdForFiles, siteEdgeManifestSchema } from "../../src/publish/manifest-edge";
import type { Env } from "../src/env";
import { handle, type WorkerDeps } from "../src/worker";

const SITE_ID = "a".repeat(26);
const HOST_HANDLE = "edge-contract-host";
const SITE_HTML = "<h1>secret publication</h1>";
const SITE_CSS = "body { color: rebeccapurple; }";
const OUT_OF_RELEASE_SENTINEL = "OUT-OF-RELEASE-SENTINEL";
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

const EXPECTED_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const deps: WorkerDeps = { now: () => NOW, jwksFor: () => async () => null };

function pinnedEnv(): Env {
  return {
    PUB_STORE: env.PUB_STORE,
    ACCESS_TEAM_DOMAIN: undefined,
    ACCESS_AUD: undefined,
    PUB_WORKER_VERSION: undefined,
    PUB_ID: SITE_ID,
    HOST_HANDLE,
  };
}

function get(path: string, init?: RequestInit): Promise<Response> {
  return handle({ request: new Request(`https://pub.example.com${path}`, init), env: pinnedEnv(), deps });
}

function assertSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    expect(res.headers.get(name), `header ${name}`).toBe(value);
  }
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSite(fields: { expiresAt: string | null }): Promise<void> {
  const files = { "index.html": SITE_HTML, "app.css": SITE_CSS };
  const inventory = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([filePath, body]) => [filePath, { bytes: new TextEncoder().encode(body).byteLength, sha256: await sha256Hex(body) }] as const),
    ),
  );
  const releaseId = await releaseIdForFiles(inventory);
  const manifest = siteEdgeManifestSchema.parse({
    kind: "site",
    hostHandle: HOST_HANDLE,
    tier: "secret",
    status: "live",
    expiresAt: fields.expiresAt,
    activeRelease: { id: releaseId, files: inventory },
  });
  await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify(manifest));
  for (const [filePath, body] of Object.entries(files)) {
    await env.PUB_STORE.put(`pubs/${SITE_ID}/releases/${releaseId}/${filePath}`, body);
  }
}

beforeEach(async () => {
  await seedSite({ expiresAt: null });
  // Out-of-release sentinels a traversal must never reach.
  await env.PUB_STORE.put(`pubs/${SITE_ID}/secret.txt`, OUT_OF_RELEASE_SENTINEL);
  await env.PUB_STORE.put(`shared-routes/${SITE_ID}/route.json`, OUT_OF_RELEASE_SENTINEL);
});

describe("no publication bindings", () => {
  it("fails closed with a 500 naming the misconfiguration, never reading R2", async () => {
    // wrangler.jsonc binds only PUB_STORE, so the deployed-default Worker has no mode.
    const res = await SELF.fetch(`https://pub.example.com/s/${SITE_ID}/index.html`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Publication Worker is not configured: no pinned-site or shared-host bindings");
    assertSecurityHeaders(res);
  });
});

describe("header set on every response class", () => {
  it("200 serves the asset with its content type", async () => {
    const res = await get(`/s/${SITE_ID}/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await res.text()).toBe(SITE_CSS);
    assertSecurityHeaders(res);
  });

  it("404 for a missing asset", async () => {
    const res = await get(`/s/${SITE_ID}/missing.html`);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });

  it("405 for a non-GET method", async () => {
    const res = await get(`/s/${SITE_ID}/index.html`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    assertSecurityHeaders(res);
  });

  it("410 once the publication is past its expiresAt", async () => {
    await seedSite({ expiresAt: new Date(NOW - 1000).toISOString() });
    const res = await get(`/s/${SITE_ID}/index.html`);
    expect(res.status).toBe(410);
    assertSecurityHeaders(res);
  });
});

describe("invalid manifest → 404, never 500", () => {
  it("404s a manifest that is not valid JSON", async () => {
    await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, "{ this is not json");
    const res = await get(`/s/${SITE_ID}/index.html`);
    expect(res.status).toBe(404);
    assertSecurityHeaders(res);
  });

  it("404s a manifest that fails schema validation", async () => {
    await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify({ tier: "secret", status: "live" }));
    expect((await get(`/s/${SITE_ID}/index.html`)).status).toBe(404);
  });
});

describe("serve-time traversal — every form 404s and never returns the target", () => {
  const cases: Array<{ name: string; path: string }> = [
    { name: "encoded ..", path: `/s/${SITE_ID}/%2e%2e` },
    { name: "..%2f to reach the manifest", path: `/s/${SITE_ID}/..%2f..%2fmanifest.json` },
    { name: "plain ../ (URL-normalized away, still 404)", path: `/s/${SITE_ID}/../manifest.json` },
    { name: "..%2f chain to reach an out-of-release object", path: `/s/${SITE_ID}/..%2f..%2fsecret.txt` },
    { name: "..%2f chain to reach a route marker", path: `/s/${SITE_ID}/..%2f..%2f..%2f..%2fshared-routes%2f${SITE_ID}%2froute.json` },
    { name: "double slash (empty segment)", path: `/s/${SITE_ID}//index.html` },
    { name: "encoded backslash", path: `/s/${SITE_ID}/..%5cmanifest.json` },
    { name: "reserved __ prefix", path: `/s/${SITE_ID}/__proto__` },
  ];

  for (const { name, path } of cases) {
    it(`rejects ${name}`, async () => {
      const res = await get(path);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe("Not Found");
      expect(body).not.toContain("\"tier\"");
      expect(body).not.toContain(OUT_OF_RELEASE_SENTINEL);
    });
  }
});

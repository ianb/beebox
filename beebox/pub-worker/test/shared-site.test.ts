import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { releaseIdForFiles, siteEdgeManifestSchema, type SiteEdgeManifest } from "../../src/publish/manifest-edge";
import type { Env } from "../src/env";
import { handle, type WorkerDeps } from "../src/index";

const PUB_ID = "h".repeat(26);
const SECRET_PUB_ID = "i".repeat(26);
const BOX_HANDLE = "box-random-handle";
const SITE_HANDLE = "site-random-handle";
const HOSTNAME = "publish.example.org";
const HTML = "<h1>shared route</h1>";
const CSS = "body { color: black }";
const JSON_CONTENT = "{\"version\":1}";
const NOW = Date.parse("2026-09-26T12:00:00.000Z");
type ManifestStatus = "live" | "disabled" | "revoked";
const deps: WorkerDeps = { now: () => NOW, jwksFor: () => async () => null, newId: () => "unused" };

function sharedEnv(overrides: Partial<Env> = {}): Env {
  return {
    PUB_STORE: env.PUB_STORE,
    PUB_INGEST: env.PUB_INGEST,
    ACCESS_TEAM_DOMAIN: undefined,
    ACCESS_AUD: undefined,
    PUB_WORKER_VERSION: undefined,
    PUB_WORKER_MODE: "shared-v1",
    PUB_BOX_HANDLE: BOX_HANDLE,
    PUB_HOSTNAME: HOSTNAME,
    ...overrides,
  };
}

function request(path: string, requestEnv: Env = sharedEnv(), hostname = HOSTNAME, init?: RequestInit): Promise<Response> {
  return handle({ request: new Request(`https://${hostname}${path}`, init), env: requestEnv, deps });
}

async function makeRelease(files: Record<string, string>) {
  const inventory = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([path, body]) => {
    const bytes = new TextEncoder().encode(body);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return [path, { bytes: bytes.byteLength, sha256 }];
  })));
  return { id: await releaseIdForFiles(inventory), files: inventory };
}

async function seed(status: ManifestStatus = "live") {
  const files = { "index.html": HTML, "docs/index.html": "<h1>Docs</h1>", "assets/site.css": CSS, "assets/site.json": JSON_CONTENT };
  const activeRelease = await makeRelease(files);
  const manifest: SiteEdgeManifest = siteEdgeManifestSchema.parse({
    kind: "site", hostHandle: SITE_HANDLE, tier: "public", slug: "hello", status,
    expiresAt: null, activeRelease,
  });
  await env.PUB_STORE.put(`pubs/${PUB_ID}/manifest.json`, JSON.stringify(manifest));
  await env.PUB_STORE.put(`pubs/${PUB_ID}/releases/${activeRelease.id}/index.html`, HTML);
  await env.PUB_STORE.put(`pubs/${PUB_ID}/releases/${activeRelease.id}/docs/index.html`, "<h1>Docs</h1>");
  await env.PUB_STORE.put(`pubs/${PUB_ID}/releases/${activeRelease.id}/assets/site.css`, CSS);
  await env.PUB_STORE.put(`pubs/${PUB_ID}/releases/${activeRelease.id}/assets/site.json`, JSON_CONTENT);
  await env.PUB_STORE.put(`slugs/hello`, PUB_ID);
  await env.PUB_STORE.put(`shared-routes/${PUB_ID}/route.json`, JSON.stringify({
    schemaVersion: 1, pubId: PUB_ID, boxHostHandle: BOX_HANDLE, hostname: HOSTNAME,
    path: "/hello/", manifestHostHandle: SITE_HANDLE,
  }));
  return activeRelease.id;
}

async function seedSecret() {
  const files = { "index.html": HTML, "assets/site.css": CSS, "assets/site.json": JSON_CONTENT };
  const activeRelease = await makeRelease(files);
  const manifest: SiteEdgeManifest = siteEdgeManifestSchema.parse({
    kind: "site", hostHandle: SITE_HANDLE, tier: "secret", status: "live", expiresAt: null, activeRelease,
  });
  await env.PUB_STORE.put(`pubs/${SECRET_PUB_ID}/manifest.json`, JSON.stringify(manifest));
  await env.PUB_STORE.put(`pubs/${SECRET_PUB_ID}/releases/${activeRelease.id}/index.html`, HTML);
  await env.PUB_STORE.put(`pubs/${SECRET_PUB_ID}/releases/${activeRelease.id}/assets/site.css`, CSS);
  await env.PUB_STORE.put(`pubs/${SECRET_PUB_ID}/releases/${activeRelease.id}/assets/site.json`, JSON_CONTENT);
  await env.PUB_STORE.put(`shared-routes/${SECRET_PUB_ID}/route.json`, JSON.stringify({
    schemaVersion: 1, pubId: SECRET_PUB_ID, boxHostHandle: BOX_HANDLE, hostname: HOSTNAME,
    path: `/s/${SECRET_PUB_ID}/`, manifestHostHandle: SITE_HANDLE,
  }));
  return activeRelease.id;
}

beforeEach(async () => {
  await env.PUB_STORE.delete(`pubs/${PUB_ID}/manifest.json`);
  await env.PUB_STORE.delete(`shared-routes/${PUB_ID}/route.json`);
  await env.PUB_STORE.delete("slugs/hello");
  await env.PUB_STORE.delete(`pubs/${SECRET_PUB_ID}/manifest.json`);
  await env.PUB_STORE.delete(`shared-routes/${SECRET_PUB_ID}/route.json`);
});

describe("shared-host routes", () => {
  it("serves active assets at approved stable public paths and rejects release-qualified URLs", async () => {
    const releaseId = await seed();
    const page = await request("/hello/");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(HTML);
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(page.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    const head = await request("/hello/", sharedEnv(), HOSTNAME, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const rootWithoutSlash = await request("/hello?source=typed");
    expect(rootWithoutSlash.status).toBe(308);
    expect(rootWithoutSlash.headers.get("Location")).toBe(`https://${HOSTNAME}/hello/?source=typed`);
    const asset = await request("/hello/assets/site.css");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(CSS);
    const json = await request("/hello/assets/site.json");
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await json.text()).toBe(JSON_CONTENT);
    expect((await request(`/hello/__release/${releaseId}/index.html`)).status).toBe(404);
    expect((await request(`/hello/%5F%5Frelease/${releaseId}/index.html`)).status).toBe(404);

    const updatedFiles = { "index.html": "<h1>updated shared route</h1>", "docs/index.html": "<h1>Updated docs</h1>", "assets/site.css": "body { color: blue }" };
    const updated = await makeRelease(updatedFiles);
    for (const [path, body] of Object.entries(updatedFiles)) {
      await env.PUB_STORE.put(`pubs/${PUB_ID}/releases/${updated.id}/${path}`, body);
    }
    const stored = await env.PUB_STORE.get(`pubs/${PUB_ID}/manifest.json`);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const manifest = siteEdgeManifestSchema.parse(JSON.parse(await stored.text()));
    expect(manifest.kind).toBe("site");
    if (manifest.kind !== "site") return;
    await env.PUB_STORE.put(`pubs/${PUB_ID}/manifest.json`, JSON.stringify({ ...manifest, activeRelease: updated }));
    expect(await (await request("/hello/?view=latest")).text()).toBe(updatedFiles["index.html"]);
    expect(await (await request("/hello/assets/site.css")).text()).toBe(updatedFiles["assets/site.css"]);
    const nestedWithoutSlash = await request("/hello/docs");
    expect(nestedWithoutSlash.status).toBe(308);
    expect(nestedWithoutSlash.headers.get("Location")).toBe(`https://${HOSTNAME}/hello/docs/`);
  });

  it("does not list routes or serve a route before its marker is approved", async () => {
    await seed();
    expect((await request("/")).status).toBe(404);
    await env.PUB_STORE.delete(`shared-routes/${PUB_ID}/route.json`);
    expect((await request("/hello/")).status).toBe(404);
  });

  it("rejects reserved infrastructure roots as public slugs", async () => {
    for (const root of ["s", "p", "a", "__release"]) {
      expect((await request(`/${root}/`)).status).toBe(404);
    }
  });

  it("serves secret content only below its PubId path and rejects release-qualified URLs", async () => {
    const releaseId = await seedSecret();
    const page = await request(`/s/${SECRET_PUB_ID}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(HTML);
    const asset = await request(`/s/${SECRET_PUB_ID}/assets/site.css`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(CSS);
    const json = await request(`/s/${SECRET_PUB_ID}/assets/site.json`);
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await json.text()).toBe(JSON_CONTENT);
    expect((await request(`/s/${SECRET_PUB_ID}/__release/${releaseId}/index.html`)).status).toBe(404);
    expect((await request(`/s/${SECRET_PUB_ID}/%5F%5Frelease/${releaseId}/index.html`)).status).toBe(404);
    expect((await request(`/s/${"j".repeat(26)}/`)).status).toBe(404);
  });

  it("fails closed for wrong host, stale slug pointer, and marker disagreement", async () => {
    await seed();
    expect((await request("/hello/", sharedEnv(), "other.example.org")).status).toBe(404);
    await env.PUB_STORE.put("slugs/hello", "j".repeat(26));
    expect((await request("/hello/")).status).toBe(404);
    await env.PUB_STORE.put("slugs/hello", PUB_ID);
    await env.PUB_STORE.put(`shared-routes/${PUB_ID}/route.json`, JSON.stringify({
      schemaVersion: 1, pubId: PUB_ID, boxHostHandle: "other-box", hostname: HOSTNAME,
      path: "/hello/", manifestHostHandle: SITE_HANDLE,
    }));
    expect((await request("/hello/")).status).toBe(404);
  });

  it("keeps disabled and revoked manifest state authoritative over the route marker", async () => {
    const releaseId = await seed("disabled");
    expect((await request("/hello/")).status).toBe(410);
    expect((await request(`/hello/__release/${releaseId}/index.html`)).status).toBe(410);
    await seed("revoked");
    expect((await request("/hello/")).status).toBe(410);
  });

  it("requires the manifest tier and slug to agree with the requested public route", async () => {
    await seed();
    const stored = await env.PUB_STORE.get(`pubs/${PUB_ID}/manifest.json`);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    const publicManifest = siteEdgeManifestSchema.parse(JSON.parse(await stored.text()));
    expect(publicManifest.tier).toBe("public");
    await env.PUB_STORE.put(`pubs/${PUB_ID}/manifest.json`, JSON.stringify({ ...publicManifest, slug: "other" }));
    expect((await request("/hello/")).status).toBe(404);
    await env.PUB_STORE.put(`pubs/${PUB_ID}/manifest.json`, JSON.stringify({
      kind: "site", hostHandle: SITE_HANDLE, tier: "secret", status: "live", expiresAt: null,
      activeRelease: publicManifest.activeRelease,
    }));
    expect((await request("/hello/")).status).toBe(404);
  });

  it("rejects partial shared-mode bindings instead of falling back to legacy routing", async () => {
    const incomplete = sharedEnv();
    delete incomplete.PUB_HOSTNAME;
    expect((await request("/hello/", incomplete)).status).toBe(404);
  });
});

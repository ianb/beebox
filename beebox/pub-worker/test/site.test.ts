import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { releaseIdForFiles, siteEdgeManifestSchema, type SiteEdgeManifest } from "../../src/publish/manifest-edge";
import type { Env } from "../src/env";
import { handle, type WorkerDeps } from "../src/index";

const SITE_ID = "h".repeat(26);
const HOST_HANDLE = "site-random-handle";
const OLD_HTML = "<main>old release</main>";
const NEW_HTML = "<main>new release</main>";
const CSS = "main { color: black }";
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

const deps: WorkerDeps = {
  now: () => NOW,
  jwksFor: () => async () => null,
  newId: () => "test-id",
};

function workerEnv(pubId = SITE_ID, hostHandle = HOST_HANDLE): Env {
  return {
    PUB_STORE: env.PUB_STORE,
    PUB_INGEST: env.PUB_INGEST,
    ACCESS_TEAM_DOMAIN: undefined,
    ACCESS_AUD: undefined,
    PUB_WORKER_VERSION: undefined,
    PUB_ID: pubId,
    HOST_HANDLE: hostHandle,
  };
}

async function release(files: Record<string, string>) {
  const inventory = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([filePath, body]) => {
        const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
        const sha256 = Array.from(new Uint8Array(sha), (byte) => byte.toString(16).padStart(2, "0")).join("");
        return [filePath, { bytes: new TextEncoder().encode(body).byteLength, sha256 }];
      }),
    ),
  );
  return { id: await releaseIdForFiles(inventory), files: inventory };
}

async function seed(manifest: SiteEdgeManifest, bodies: Record<string, Record<string, string>>): Promise<void> {
  await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify(manifest));
  for (const [releaseId, files] of Object.entries(bodies)) {
    for (const [path, body] of Object.entries(files)) {
      await env.PUB_STORE.put(`pubs/${SITE_ID}/releases/${releaseId}/${path}`, body);
    }
  }
}

function request(path: string, requestInit?: RequestInit, bindings?: Pick<Env, "PUB_ID" | "HOST_HANDLE">): Promise<Response> {
  return handle({
    request: new Request(`https://published.example.com${path}`, requestInit),
    env: { ...workerEnv(), ...bindings },
    deps,
  });
}

function secretManifest(fields: Partial<Extract<SiteEdgeManifest, { tier: "secret" }>> = {}) {
  return siteEdgeManifestSchema.parse({
    kind: "site",
    hostHandle: HOST_HANDLE,
    tier: "secret",
    status: "live",
    expiresAt: null,
    activeRelease: fields.activeRelease,
    ...(fields.previousRelease === undefined ? {} : { previousRelease: fields.previousRelease }),
  });
}

async function readSecretManifest(): Promise<Extract<SiteEdgeManifest, { tier: "secret" }>> {
  const raw = await env.PUB_STORE.get(`pubs/${SITE_ID}/manifest.json`);
  if (raw === null) throw new Error();
  const manifest = siteEdgeManifestSchema.parse(JSON.parse(await raw.text()));
  if (manifest.tier !== "secret") throw new Error();
  return manifest;
}

beforeEach(async () => {
  const current = await release({ "index.html": NEW_HTML, "about.html": "<h1>About</h1>", "site.css": CSS });
  const previous = await release({ "index.html": OLD_HTML, "site.css": CSS });
  await seed(
    secretManifest({
      activeRelease: current,
      previousRelease: { ...previous, expiresAt: new Date(NOW + 5 * 60_000).toISOString() },
    }),
    { [current.id]: { "index.html": NEW_HTML, "about.html": "<h1>About</h1>", "site.css": CSS }, [previous.id]: { "index.html": OLD_HTML, "site.css": CSS } },
  );
});

describe("pinned site Worker", () => {
  it("keeps secret entry paths secret and redirects the stable document to its release", async () => {
    const res = await request(`/s/${SITE_ID}/about.html`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://published.example.com/s/${SITE_ID}/__release/${(await activeId())}/about.html`);
    expect(res.headers.get("Location")).not.toContain(HOST_HANDLE);
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
  });

  it("does not reveal a secret PubId from the host root", async () => {
    const res = await request("/");
    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("serves only manifest-listed files under an active release", async () => {
    const releaseId = await activeId();
    await env.PUB_STORE.put(`pubs/${SITE_ID}/releases/${releaseId}/not-listed.js`, "private sentinel");
    const listed = await request(`/s/${SITE_ID}/__release/${releaseId}/site.css`);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toBe(CSS);
    expect(listed.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(listed.headers.get("Content-Length")).toBe(String(CSS.length));
    const unlisted = await request(`/s/${SITE_ID}/__release/${releaseId}/not-listed.js`);
    expect(unlisted.status).toBe(404);
  });

  it("keeps an old document's relative assets on its previous immutable release for at most ten minutes", async () => {
    const manifest = await readSecretManifest();
    const oldId = manifest.previousRelease!.id;
    const oldDoc = await request(`/s/${SITE_ID}/__release/${oldId}/index.html`);
    expect(oldDoc.status).toBe(200);
    expect(await oldDoc.text()).toBe(OLD_HTML);

    const expired = { ...manifest, previousRelease: { ...manifest.previousRelease!, expiresAt: new Date(NOW).toISOString() } };
    await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify(expired));
    const staleDocument = await request(`/s/${SITE_ID}/__release/${oldId}/index.html`);
    expect(staleDocument.status).toBe(302);
    expect(staleDocument.headers.get("Location")).toContain(`/s/${SITE_ID}/__release/${manifest.activeRelease.id}/index.html`);
    expect((await request(`/s/${SITE_ID}/__release/${oldId}/site.css`)).status).toBe(404);
  });

  it("gates every URL while disabled and permits reenablement by the serving authority", async () => {
    const manifest = await readSecretManifest();
    const disabled = { ...manifest, status: "disabled" as const };
    await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify(disabled));
    expect((await request("/")).status).toBe(410);
    expect((await request(`/s/${SITE_ID}/__release/${manifest.activeRelease.id}/index.html`)).status).toBe(410);

    await env.PUB_STORE.put(`pubs/${SITE_ID}/manifest.json`, JSON.stringify({ ...disabled, status: "live" }));
    expect((await request(`/s/${SITE_ID}/__release/${manifest.activeRelease.id}/index.html`)).status).toBe(200);
  });

  it("fails closed for wrong host handles, mismatched PubIds, and incomplete pinned bindings", async () => {
    expect((await request(`/s/${SITE_ID}/`, undefined, { HOST_HANDLE: "other-host" })).status).toBe(404);
    expect((await request(`/s/${"j".repeat(26)}/`)).status).toBe(404);
    expect((await request(`/s/${SITE_ID}/`, undefined, { HOST_HANDLE: "" })).status).toBe(404);
  });

  it("fails closed when a release id does not match its file inventory hash", async () => {
    const manifest = await readSecretManifest();
    await env.PUB_STORE.put(
      `pubs/${SITE_ID}/manifest.json`,
      JSON.stringify({ ...manifest, activeRelease: { ...manifest.activeRelease, id: "0".repeat(64) } }),
    );
    expect((await request(`/s/${SITE_ID}/`)).status).toBe(404);
  });

  it("uses tier-aware routes so public s/a paths remain available and slug aliases are checked", async () => {
    const files = {
      "index.html": NEW_HTML,
      "s/ordinary.html": "public s path",
      "a/ordinary.html": "public a path",
    };
    const activeRelease = await release(files);
    const manifest: SiteEdgeManifest = {
      kind: "site",
      hostHandle: HOST_HANDLE,
      tier: "public",
      slug: "my-site",
      status: "live",
      expiresAt: null,
      activeRelease,
    };
    await seed(manifest, { [activeRelease.id]: files });

    for (const path of ["/s/ordinary.html", "/a/ordinary.html"]) {
      const res = await request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain(`/__release/${activeRelease.id}/`);
    }
    const alias = await request("/p/my-site/");
    expect(alias.status).toBe(302);
    expect(alias.headers.get("Location")).toContain(`/__release/${activeRelease.id}/index.html`);
    expect((await request("/p/another-site/")).status).toBe(404);
  });

  it("rejects an empty account allowlist instead of widening it", async () => {
    const activeRelease = await release({ "index.html": NEW_HTML });
    await seed(
      {
        kind: "site",
        hostHandle: HOST_HANDLE,
        tier: "accounts",
        allowedEmails: [],
        status: "live",
        expiresAt: null,
        activeRelease,
      },
      { [activeRelease.id]: { "index.html": NEW_HTML } },
    );
    expect((await request(`/a/${SITE_ID}/`)).status).toBe(404);
  });
});

async function activeId(): Promise<string> {
  const manifest = await readSecretManifest();
  return manifest.activeRelease.id;
}

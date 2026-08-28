// Unit tests for router-site.ts: the static-site resolver's traversal guard,
// directory-index / trailing-slash canonicalization, missing-file handling,
// plus the auto-build path (content-hash staleness, serialization,
// 500-on-failure) over a fake http.ServerResponse. Run with:
//   node --import tsx --test bin/router-site.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSiteTarget, serveSite, SiteBuildError, type BuildRunner } from "./router-site.js";
import { writeManifest } from "../site/sources.js";

// A checkout with a site/ generator, real sources, and a fully built dist/ whose
// input manifest matches those sources (so isStale() is false until something
// changes). Enough shape for both resolveSiteTarget and the auto-build path.
async function mkBuiltSite(): Promise<{ repoRoot: string; siteDir: string; distRoot: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-site-test-"));
  const siteDir = path.join(repoRoot, "site");
  await fs.mkdir(path.join(siteDir, "content"), { recursive: true });
  await fs.writeFile(path.join(siteDir, "build.ts"), "// generator stub\n", "utf8");
  await fs.writeFile(path.join(siteDir, "package.json"), JSON.stringify({ name: "site" }), "utf8");
  await fs.writeFile(path.join(siteDir, "content", "index.md"), "---\ntitle: T\nsummary: S\n---\nbody\n", "utf8");
  const distRoot = path.join(siteDir, "dist");
  await fs.mkdir(path.join(distRoot, "sub"), { recursive: true });
  await fs.writeFile(path.join(distRoot, "index.html"), "<!doctype html><title>home</title>", "utf8");
  await fs.writeFile(path.join(distRoot, "index.md"), "# home\n", "utf8");
  await fs.writeFile(path.join(distRoot, "llms.txt"), "# home\n", "utf8");
  await fs.writeFile(path.join(distRoot, "sub", "index.html"), "<!doctype html><title>sub</title>", "utf8");
  await writeManifest(siteDir, distRoot);
  return { repoRoot, siteDir, distRoot };
}

// A build runner that stands in for `pnpm --dir site build`: writes a minimal
// dist + a matching manifest and counts its invocations.
function countingRunner(counter: { n: number }): BuildRunner {
  return async ({ siteDir }) => {
    const distRoot = path.join(siteDir, "dist");
    await fs.mkdir(distRoot, { recursive: true });
    await fs.writeFile(path.join(distRoot, "index.html"), "<!doctype html><title>built</title>", "utf8");
    await writeManifest(siteDir, distRoot);
    counter.n += 1;
  };
}

// --- resolveSiteTarget --------------------------------------------------------

test("resolveSiteTarget: root path serves index.html", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(t.abs), "index.html");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a bare file path resolves to that file", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/llms.txt" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(t.abs), "llms.txt");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a directory without a trailing slash redirects", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/sub" });
  assert.equal(t.kind, "redirect");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a directory with a trailing slash serves its index.html", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/sub/" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(path.dirname(t.abs)), "sub");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a missing file is not-found (no directory listing)", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/nope.html" });
  assert.equal(t.kind, "not-found");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: path traversal outside dist is forbidden", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/../../secret" });
  assert.equal(t.kind, "forbidden");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: an unbuilt dist reports no-dist", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-site-nodist-"));
  const t = await resolveSiteTarget({ distRoot: path.join(repoRoot, "site", "dist"), rel: "/" });
  assert.equal(t.kind, "no-dist");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

// --- serveSite (end-to-end over a fake ServerResponse) ------------------------

// A stand-in for the generator's own error text, so the 500 path can assert the
// build's output reaches the response body verbatim.
const FRONTMATTER_BUILD_FAILURE = "site/content/x.md:3 invalid frontmatter YAML: bad indentation";

/** Thrown by a runner that must never be invoked, so the test fails loudly if it is. */
class UnexpectedBuildError extends Error {
  constructor() {
    super("should not build when there is no generator");
    this.name = "UnexpectedBuildError";
  }
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  setHeaders: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string | Buffer): void;
}

function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    headers: {},
    setHeaders: {},
    body: "",
    setHeader(name, value) {
      this.setHeaders[name.toLowerCase()] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      if (chunk !== undefined) this.body = chunk.toString();
    },
  };
}

async function request(repoRoot: string, { rel, buildRunner }: { rel: string; buildRunner: BuildRunner }): Promise<FakeResponse> {
  const res = fakeResponse();
  await serveSite({ name: "wt", rest: `/site${rel}`, res, repoRoot, buildRunner });
  return res;
}

test("serveSite: a fresh, already-built site serves index.html with no-store and no rebuild", async () => {
  const { repoRoot } = await mkBuiltSite();
  const counter = { n: 0 };
  const res = await request(repoRoot, { rel: "/", buildRunner: countingRunner(counter) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.setHeaders["cache-control"], "no-store, max-age=0");
  assert.match(res.body, /home/);
  assert.equal(counter.n, 0);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: missing dist auto-builds, then a second request does not rebuild", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  await fs.rm(distRoot, { recursive: true, force: true });
  const counter = { n: 0 };
  const runner = countingRunner(counter);

  const first = await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(first.statusCode, 200);
  assert.match(first.body, /built/);
  assert.equal(counter.n, 1);

  const second = await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(second.statusCode, 200);
  assert.equal(counter.n, 1); // fresh manifest → no second build
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: a changed source (same set) triggers a rebuild", async () => {
  const { repoRoot, siteDir } = await mkBuiltSite();
  const counter = { n: 0 };
  const runner = countingRunner(counter);

  await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(counter.n, 0); // fresh

  await fs.writeFile(path.join(siteDir, "content", "index.md"), "---\ntitle: T2\nsummary: S2\n---\nedited\n", "utf8");
  await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(counter.n, 1); // content hash changed → rebuild
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: a deleted source triggers a rebuild (content-based, not mtime)", async () => {
  const { repoRoot, siteDir } = await mkBuiltSite();
  const counter = { n: 0 };
  const runner = countingRunner(counter);

  await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(counter.n, 0); // fresh

  await fs.rm(path.join(siteDir, "content", "index.md"));
  await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(counter.n, 1); // source set shrank → manifest differs → rebuild
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: a missing manifest is treated as stale and rebuilds", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  await fs.rm(path.join(distRoot, ".inputs.json"));
  const counter = { n: 0 };
  await request(repoRoot, { rel: "/", buildRunner: countingRunner(counter) });
  assert.equal(counter.n, 1);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: concurrent requests on a stale site share one build", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  await fs.rm(distRoot, { recursive: true, force: true });
  const counter = { n: 0 };
  const runner = countingRunner(counter);
  const [a, b, c] = await Promise.all([
    request(repoRoot, { rel: "/", buildRunner: runner }),
    request(repoRoot, { rel: "/", buildRunner: runner }),
    request(repoRoot, { rel: "/", buildRunner: runner }),
  ]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(c.statusCode, 200);
  assert.equal(counter.n, 1); // one build served all three
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: a build failure returns 500 with the build's error text", async () => {
  const { repoRoot, distRoot } = await mkBuiltSite();
  await fs.rm(distRoot, { recursive: true, force: true });
  const failing: BuildRunner = async () => {
    throw new SiteBuildError(FRONTMATTER_BUILD_FAILURE);
  };
  const res = await request(repoRoot, { rel: "/", buildRunner: failing });
  assert.equal(res.statusCode, 500);
  assert.match(res.body, /invalid frontmatter YAML: bad indentation/);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: a checkout with no site/ generator keeps the 404 build hint", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-site-nogen-"));
  const runner: BuildRunner = async () => {
    throw new UnexpectedBuildError();
  };
  const res = await request(repoRoot, { rel: "/", buildRunner: runner });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /pnpm --dir site build/);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

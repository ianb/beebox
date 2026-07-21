// Unit tests for router-site.ts: the static-site resolver's traversal guard,
// directory-index / trailing-slash canonicalization, missing-file and
// missing-dist handling, plus an end-to-end serveSite response over a fake
// http.ServerResponse. Run with:
//   node --import tsx --test bin/router-site.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { resolveSiteTarget, serveSite } from "./router-site.js";

async function mkFixtureSite(): Promise<{ repoRoot: string; distRoot: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-site-test-"));
  const distRoot = path.join(repoRoot, "site", "dist");
  await fs.mkdir(distRoot, { recursive: true });
  await fs.writeFile(path.join(distRoot, "index.html"), "<!doctype html><title>home</title>", "utf8");
  await fs.writeFile(path.join(distRoot, "index.md"), "# home\n", "utf8");
  await fs.writeFile(path.join(distRoot, "llms.txt"), "# home\n", "utf8");
  await fs.mkdir(path.join(distRoot, "sub"), { recursive: true });
  await fs.writeFile(path.join(distRoot, "sub", "index.html"), "<!doctype html><title>sub</title>", "utf8");
  return { repoRoot, distRoot };
}

// --- resolveSiteTarget --------------------------------------------------------

test("resolveSiteTarget: root path serves index.html", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(t.abs), "index.html");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a bare file path resolves to that file", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/llms.txt" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(t.abs), "llms.txt");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a directory without a trailing slash redirects", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/sub" });
  assert.equal(t.kind, "redirect");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a directory with a trailing slash serves its index.html", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/sub/" });
  assert.equal(t.kind, "file");
  assert.equal(t.kind === "file" && path.basename(path.dirname(t.abs)), "sub");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: a missing file is not-found (no directory listing)", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
  const t = await resolveSiteTarget({ distRoot, rel: "/nope.html" });
  assert.equal(t.kind, "not-found");
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("resolveSiteTarget: path traversal outside dist is forbidden", async () => {
  const { repoRoot, distRoot } = await mkFixtureSite();
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

test("serveSite: root request returns index.html with no-store", async () => {
  const { repoRoot } = await mkFixtureSite();
  const res = fakeResponse();
  await serveSite({ name: "wt", rest: "/site/", res: res as unknown as http.ServerResponse, repoRoot });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.setHeaders["cache-control"], "no-store, max-age=0");
  assert.match(res.body, /home/);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

test("serveSite: missing dist returns 404 with the build hint", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "router-site-hint-"));
  const res = fakeResponse();
  await serveSite({ name: "wt", rest: "/site/", res: res as unknown as http.ServerResponse, repoRoot });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /pnpm --dir site build/);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

// Unit tests for router-docs.ts's per-worktree dev/tools.json cards. Run with:
//   node --import tsx --test bin/router-docs.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { renderMarkdownToHtml, renderWorktreeToolCards, readDevTools, isPathInScriptedApp, serveDev } from "./router-docs.js";

test("manual testing headings get a stable anchor", () => {
  assert.match(renderMarkdownToHtml("## Manual testing\n\nTry it."), /<h2 id="manual-testing">/);
});

async function mkDevRoot(toolsJson?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devroot-"));
  if (toolsJson !== undefined) await fs.writeFile(path.join(dir, "tools.json"), toolsJson, "utf8");
  return dir;
}

// Minimal ServerResponse stand-in that records the final Content-Security-Policy
// (setHeader value survives writeHead in real Node unless writeHead re-sets it,
// which serveDev never does for CSP — so last setHeader wins).
function fakeRes(): { csp: () => string | undefined; res: http.ServerResponse } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    writeHead(_c: number, h?: Record<string, string>) { if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    end() {},
  };
  return { csp: () => headers["content-security-policy"], res: res as unknown as http.ServerResponse };
}

// A worktree with a scripted story-eval app and a sibling payload.html.
async function mkScriptedRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "repo-"));
  const dev = path.join(repo, "dev");
  await fs.mkdir(path.join(dev, "story-eval"), { recursive: true });
  await fs.writeFile(path.join(dev, "tools.json"), JSON.stringify({ tools: [], scripted: ["story-eval"] }));
  await fs.writeFile(path.join(dev, "story-eval", "index.html"), "<h1>app</h1>");
  await fs.writeFile(path.join(dev, "payload.html"), "<h1>evil</h1>");
  return repo;
}

async function cspFor(repo: string, rest: string): Promise<string | undefined> {
  const { csp, res } = fakeRes();
  await serveDev({ name: "wt", rest, res, repoRoot: repo });
  return csp();
}

test("no tools.json → no cards", async () => {
  const dev = await mkDevRoot();
  assert.equal(await renderWorktreeToolCards("wt", dev), "");
});

test("valid tools.json renders cards with worktree-root-relative href", async () => {
  const dev = await mkDevRoot(
    JSON.stringify({ tools: [{ emoji: "🔎", title: "Story-eval", href: "dev/story-eval/index.html", desc: "triage" }] }),
  );
  const html = await renderWorktreeToolCards("my wt", dev);
  assert.match(html, /🔎 Story-eval/);
  assert.match(html, /href="\/my%20wt\/dev\/story-eval\/index\.html"/);
  assert.match(html, /triage/);
});

test("absolute https href passes through unchanged", async () => {
  const dev = await mkDevRoot(JSON.stringify({ tools: [{ title: "Dash", href: "https://example.com/x" }] }));
  const html = await renderWorktreeToolCards("wt", dev);
  assert.match(html, /href="https:\/\/example\.com\/x"/);
  assert.match(html, /🔧 Dash/); // default emoji
});

test("malformed tools.json degrades to no cards, does not throw", async () => {
  const dev = await mkDevRoot("{ not json");
  assert.equal(await renderWorktreeToolCards("wt", dev), "");
});

test("unknown keys are rejected (strict), yielding no cards", async () => {
  const dev = await mkDevRoot(JSON.stringify({ tools: [{ title: "X", href: "y", rogue: 1 }] }));
  assert.equal(await renderWorktreeToolCards("wt", dev), "");
});

test("card content is HTML-escaped", async () => {
  const dev = await mkDevRoot(JSON.stringify({ tools: [{ title: "A & B <x>", href: "dev/z" }] }));
  const html = await renderWorktreeToolCards("wt", dev);
  assert.match(html, /A &amp; B &lt;x&gt;/);
});

test("readDevTools returns the scripted allowlist; defaults to empty", async () => {
  const withList = await mkDevRoot(JSON.stringify({ tools: [], scripted: ["story-eval"] }));
  assert.deepEqual((await readDevTools("wt", withList)).scripted, ["story-eval"]);
  const noList = await mkDevRoot(JSON.stringify({ tools: [] }));
  assert.deepEqual((await readDevTools("wt", noList)).scripted, []);
  const absent = await mkDevRoot();
  assert.deepEqual((await readDevTools("wt", absent)).scripted, []);
  const malformed = await mkDevRoot("{ not json");
  assert.deepEqual((await readDevTools("wt", malformed)).scripted, []);
});

test("readDevTools rejects unsafe scripted entries (whole file → empty)", async () => {
  for (const bad of ["..", ".", "", "a/b", "a\\b", "/abs"]) {
    const dev = await mkDevRoot(JSON.stringify({ tools: [], scripted: [bad] }));
    assert.deepEqual((await readDevTools("wt", dev)).scripted, [], `entry ${JSON.stringify(bad)} must be rejected`);
  }
});

test("isPathInScriptedApp matches by resolved path, not URL segment", () => {
  const devRoot = "/dev";
  const list = ["story-eval"];
  assert.equal(isPathInScriptedApp("/dev/story-eval", devRoot, list), true);
  assert.equal(isPathInScriptedApp("/dev/story-eval/index.html", devRoot, list), true);
  assert.equal(isPathInScriptedApp("/dev/story-eval/runs/x.json", devRoot, list), true);
  assert.equal(isPathInScriptedApp("/dev/story-eval-evil/index.html", devRoot, list), false); // no prefix bleed
  assert.equal(isPathInScriptedApp("/dev/payload.html", devRoot, list), false); // traversal target
  assert.equal(isPathInScriptedApp("/dev/docs/foo", devRoot, list), false);
  assert.equal(isPathInScriptedApp("/dev/story-eval/x", devRoot, []), false); // empty allowlist
});

test("serveDev grants relaxed CSP only for real files inside a scripted app", async () => {
  const repo = await mkScriptedRepo();
  const RELAXED = "sandbox allow-scripts allow-same-origin";
  // The app itself → relaxed.
  assert.equal(await cspFor(repo, "/dev/story-eval/index.html"), RELAXED);
  assert.equal(await cspFor(repo, "/dev/story-eval/"), RELAXED); // dir listing inside app, harmless
  // Everything else → bare sandbox.
  assert.equal(await cspFor(repo, "/dev/payload.html"), "sandbox");
  assert.equal(await cspFor(repo, "/dev/"), "sandbox"); // manifest
  assert.equal(await cspFor(repo, "/dev/docs/"), "sandbox");
});

test("serveDev: encoded traversal cannot steal the grant (Codex #2)", async () => {
  const repo = await mkScriptedRepo();
  // Decodes to /story-eval/../payload.html → resolves to dev/payload.html, which
  // is NOT inside the app dir, so it must stay bare sandbox even though the raw
  // first URL segment is "story-eval".
  assert.equal(await cspFor(repo, "/dev/story-eval%2F..%2Fpayload.html"), "sandbox");
});

test("serveDev: a symlink out of the app dir gets neither the grant nor escape (Codex #4)", async () => {
  const repo = await mkScriptedRepo();
  const link = path.join(repo, "dev", "story-eval", "link.html");
  // Symlink inside the app dir pointing at a sibling outside it.
  await fs.symlink(path.join(repo, "dev", "payload.html"), link);
  // Real path is dev/payload.html (inside devRoot → served, 200) but outside the
  // app dir → bare sandbox, not relaxed.
  assert.equal(await cspFor(repo, "/dev/story-eval/link.html"), "sandbox");
});

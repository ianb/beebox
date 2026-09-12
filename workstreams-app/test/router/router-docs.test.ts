// Unit tests for router-docs.ts's per-worktree dev/tools.json cards. Run with:
//   node --import tsx --test workstreams-app/test/router/router-docs.test.ts
// (or `pnpm --dir workstreams-app test`, which runs the router tests with the package suite).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readDevTools, renderWorktreeToolCards, serveDev, type DevResponse } from "../../src/router/router-docs.js";
import { renderMarkdownToHtml } from "../../src/router/router-markdown.js";

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
function fakeRes(): { csp: () => string | undefined; codes: number[]; res: DevResponse } {
  const headers: Record<string, string> = {};
  const codes: number[] = [];
  const res = {
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    writeHead(c: number, h?: Record<string, string>) { codes.push(c); if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    end() {},
  };
  return { csp: () => headers["content-security-policy"], codes, res };
}

// A worktree with an interactive-looking app dir and a sibling payload.html,
// for exercising serveDev's serving, containment, and header behavior.
async function mkAppishRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "repo-"));
  const dev = path.join(repo, "dev");
  await fs.mkdir(path.join(dev, "story-eval"), { recursive: true });
  await fs.writeFile(path.join(dev, "tools.json"), JSON.stringify({ tools: [] }));
  await fs.writeFile(path.join(dev, "story-eval", "index.html"), "<h1>app</h1>");
  await fs.writeFile(path.join(dev, "payload.html"), "<h1>evil</h1>");
  return repo;
}

async function cspFor(repo: string, rest: string): Promise<string | undefined> {
  const { csp, res } = fakeRes();
  await serveDev({ name: "wt", rest, res, repoRoot: repo });
  return csp();
}

async function codesFor(repo: string, rest: string): Promise<number[]> {
  const { codes, res } = fakeRes();
  await serveDev({ name: "wt", rest, res, repoRoot: repo });
  return codes;
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

test("tools.json carrying the retired `scripted` key is rejected (strict)", async () => {
  // The exemption is gone: a stale allowlist is an unknown key, so the whole
  // file degrades to no cards rather than being silently half-honored.
  const dev = await mkDevRoot(JSON.stringify({ tools: [{ title: "X", href: "dev/x" }], scripted: ["story-eval"] }));
  assert.deepEqual((await readDevTools("wt", dev)).tools, []);
  assert.equal(await renderWorktreeToolCards("wt", dev), "");
});

test("serveDev sets no Content-Security-Policy — normal HTML and markdown just work", async () => {
  // The B.2c bare-sandbox CSP was removed 2026-08-19 (boxholder decision): it
  // broke images in rendered markdown (opaque origin → cookieless subrequests)
  // and scripts in plain HTML, while the same-origin-scripting threat it
  // addressed is already an accepted residual for worktree frontends. This
  // test pins the absence so a future hardening pass reads the decision
  // comment in serveDev before re-adding one.
  const repo = await mkAppishRepo();
  assert.equal(await cspFor(repo, "/dev/story-eval/index.html"), undefined);
  assert.equal(await cspFor(repo, "/dev/story-eval/"), undefined);
  assert.equal(await cspFor(repo, "/dev/payload.html"), undefined);
  assert.equal(await cspFor(repo, "/dev/"), undefined); // manifest
  assert.equal(await cspFor(repo, "/dev/docs/"), undefined);
  assert.equal(await cspFor(repo, "/dev/nope.html"), undefined); // 404
  assert.equal(await cspFor(repo, "/dev/%zz"), undefined); // malformed escape
});

test("serveDev: encoded traversal stays contained", async () => {
  const repo = await mkAppishRepo();
  // Decodes to /story-eval/../payload.html → resolves to dev/payload.html:
  // inside devRoot, so it is served.
  assert.equal((await codesFor(repo, "/dev/story-eval%2F..%2Fpayload.html"))[0], 200);
  // Above devRoot → refused outright.
  assert.deepEqual(await codesFor(repo, "/dev/..%2F..%2Fetc%2Fpasswd"), [403]);
});

test("serveDev: dotfiles under dev/ are not served, at any depth", async () => {
  const repo = await mkAppishRepo();
  await fs.writeFile(path.join(repo, "dev", ".env"), "BBX_SECRET=leak\n");
  await fs.mkdir(path.join(repo, "dev", "story-eval", ".git"), { recursive: true });
  await fs.writeFile(path.join(repo, "dev", "story-eval", ".git", "config"), "[core]\n");
  // Hidden from the listing AND refused on a direct request — the listing
  // filter alone used to hide them while serveDevArtifact still served them.
  assert.deepEqual(await codesFor(repo, "/dev/.env"), [404]);
  assert.deepEqual(await codesFor(repo, "/dev/story-eval/.git/config"), [404]);
  // The check reads the RESOLVED path, so an encoded traversal cannot dodge it.
  assert.deepEqual(await codesFor(repo, "/dev/story-eval%2F..%2F.env"), [404]);
  // A normal file beside them is unaffected.
  assert.equal((await codesFor(repo, "/dev/payload.html"))[0], 200);
});

test("serveDev: a symlink out of the app dir is contained", async () => {
  const repo = await mkAppishRepo();
  const link = path.join(repo, "dev", "story-eval", "link.html");
  // Symlink inside the app dir pointing at a sibling still inside dev/.
  await fs.symlink(path.join(repo, "dev", "payload.html"), link);
  assert.deepEqual(await codesFor(repo, "/dev/story-eval/link.html"), [200]);
  // A symlink whose real path leaves dev/ is refused by the realpath re-check.
  const escape = path.join(repo, "dev", "escape.html");
  await fs.writeFile(path.join(repo, "outside.html"), "<h1>outside</h1>");
  await fs.symlink(path.join(repo, "outside.html"), escape);
  assert.deepEqual(await codesFor(repo, "/dev/escape.html"), [403]);
});

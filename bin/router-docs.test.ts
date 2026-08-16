// Unit tests for router-docs.ts's per-worktree dev/tools.json cards. Run with:
//   node --import tsx --test bin/router-docs.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  appendClosedIssuePills,
  findClosedIssueLinkHrefs,
  readDevTools,
  renderMarkdownToHtml,
  renderWorktreeToolCards,
  serveDev,
} from "./router-docs.js";

test("closed issue links in docs receive a status pill", () => {
  const markdown =
    "[closed](../issues/closed/bugs/example.md) [open](../issues/bugs/example.md)";
  const hrefs = findClosedIssueLinkHrefs(markdown, "docs");
  assert.deepEqual([...hrefs], ["../issues/closed/bugs/example.md"]);
  assert.equal(
    appendClosedIssuePills(
      '<a href="../issues/closed/bugs/example.md">closed</a> <a href="../issues/bugs/example.md">open</a>',
      hrefs,
    ),
    '<a href="../issues/closed/bugs/example.md">closed</a><span class="chip chip-closed-link">closed</span> <a href="../issues/bugs/example.md">open</a>',
  );
});

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
function fakeRes(): { csp: () => string | undefined; codes: number[]; res: http.ServerResponse } {
  const headers: Record<string, string> = {};
  const codes: number[] = [];
  const res = {
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    writeHead(c: number, h?: Record<string, string>) { codes.push(c); if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    end() {},
  };
  return { csp: () => headers["content-security-policy"], codes, res: res as unknown as http.ServerResponse };
}

// A worktree with an interactive-looking app dir and a sibling payload.html.
// Nothing here can win a scripting grant any more — the exemption is gone — so
// this fixture exists to prove exactly that.
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

test("serveDev always sends the bare sandbox CSP — there is no exemption", async () => {
  const repo = await mkAppishRepo();
  // An interactive app dir gets no grant: scripting pages live on the exhibits
  // origin now, which holds no router authority.
  assert.equal(await cspFor(repo, "/dev/story-eval/index.html"), "sandbox");
  assert.equal(await cspFor(repo, "/dev/story-eval/"), "sandbox");
  assert.equal(await cspFor(repo, "/dev/payload.html"), "sandbox");
  assert.equal(await cspFor(repo, "/dev/"), "sandbox"); // manifest
  assert.equal(await cspFor(repo, "/dev/docs/"), "sandbox");
  assert.equal(await cspFor(repo, "/dev/nope.html"), "sandbox"); // 404
  assert.equal(await cspFor(repo, "/dev/%zz"), "sandbox"); // malformed escape
});

test("serveDev: encoded traversal stays contained and stays sandboxed", async () => {
  const repo = await mkAppishRepo();
  // Decodes to /story-eval/../payload.html → resolves to dev/payload.html:
  // inside devRoot, so it is served, and sandboxed like everything else.
  assert.equal(await cspFor(repo, "/dev/story-eval%2F..%2Fpayload.html"), "sandbox");
  // Above devRoot → refused outright.
  const { res, csp, codes } = fakeRes();
  await serveDev({ name: "wt", rest: "/dev/..%2F..%2Fetc%2Fpasswd", res, repoRoot: repo });
  assert.deepEqual(codes, [403]);
  assert.equal(csp(), "sandbox");
});

test("serveDev: a symlink out of the app dir is contained, and still sandboxed", async () => {
  const repo = await mkAppishRepo();
  const link = path.join(repo, "dev", "story-eval", "link.html");
  // Symlink inside the app dir pointing at a sibling still inside dev/.
  await fs.symlink(path.join(repo, "dev", "payload.html"), link);
  assert.equal(await cspFor(repo, "/dev/story-eval/link.html"), "sandbox");
  // A symlink whose real path leaves dev/ is refused by the realpath re-check.
  const escape = path.join(repo, "dev", "escape.html");
  await fs.writeFile(path.join(repo, "outside.html"), "<h1>outside</h1>");
  await fs.symlink(path.join(repo, "outside.html"), escape);
  const { res, csp, codes } = fakeRes();
  await serveDev({ name: "wt", rest: "/dev/escape.html", res, repoRoot: repo });
  assert.deepEqual(codes, [403]);
  assert.equal(csp(), "sandbox");
});

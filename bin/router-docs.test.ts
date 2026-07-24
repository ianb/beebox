// Unit tests for router-docs.ts's per-worktree dev/tools.json cards. Run with:
//   node --import tsx --test bin/router-docs.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderWorktreeToolCards, readDevTools, isScriptedDevPath } from "./router-docs.js";

async function mkDevRoot(toolsJson?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devroot-"));
  if (toolsJson !== undefined) await fs.writeFile(path.join(dir, "tools.json"), toolsJson, "utf8");
  return dir;
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

test("isScriptedDevPath matches the first path segment exactly", () => {
  const list = ["story-eval"];
  assert.equal(isScriptedDevPath("/story-eval/index.html", list), true);
  assert.equal(isScriptedDevPath("/story-eval", list), true);
  assert.equal(isScriptedDevPath("/story-eval/runs/x.json", list), true);
  assert.equal(isScriptedDevPath("/story-eval-evil/index.html", list), false); // no prefix bleed
  assert.equal(isScriptedDevPath("/docs/foo.md", list), false);
  assert.equal(isScriptedDevPath("/", list), false);
  assert.equal(isScriptedDevPath("/story-eval/index.html", []), false); // empty allowlist
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSite } from "./build.js";
import { NAVIGATION_SCRIPT } from "./navigation-script.js";
import { ROOM_CSS, ROOM_SCRIPT } from "./room.js";

test("the loader runs on startup and after each page swap, and is part of navigation.js", () => {
  assert.ok(NAVIGATION_SCRIPT.includes(ROOM_SCRIPT));
  assert.match(NAVIGATION_SCRIPT, /runThreads\(\);\s+runRoom\(\);/);
  assert.match(ROOM_SCRIPT, /min-width: 1200px/);
  assert.match(ROOM_SCRIPT, /'gpu' in navigator/);
  assert.match(ROOM_CSS, /@media print { canvas\.site-room { display: none; } }/);
});

test("the build emits file-room.js as an ES module and no page references it", async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), "site-room-test-"));
  try {
    await buildSite({ cardsDir: path.join(import.meta.dirname, "cards"), distDir: dist, base: "/", writeSourceManifest: false, buildAgentDocs: false });
    const bundle = await fs.readFile(path.join(dist, "assets", "file-room.js"), "utf8");
    assert.match(bundle, /export\s*{[^}]*\bmountFileRoom\b/);
    for (const name of await fs.readdir(dist, { recursive: true })) {
      if (!name.endsWith(".html")) continue;
      const html = await fs.readFile(path.join(dist, name), "utf8");
      assert.ok(!html.includes("file-room.js"), `${name} must not reference file-room.js`);
    }
  } finally {
    await fs.rm(dist, { recursive: true, force: true });
  }
});

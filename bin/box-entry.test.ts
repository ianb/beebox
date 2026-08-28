// Unit test for box-entry.ts's pure entry->{contentDir, slug} resolution.
// No server spawn, no router — just fixture directories on disk. Run with:
//   node --import tsx --test bin/box-entry.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveBoxEntry, boxEntryToArg, BoxMarkerError } from "./box-entry.js";

async function makeFixtureDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "box-entry-test-"));
}

test("legacy box dir: contentDir and slug are the entry itself", async () => {
  const dir = await makeFixtureDir();
  try {
    await fs.writeFile(path.join(dir, ".cb-box"), JSON.stringify({ version: "1.0.0" }));
    const boxDir = path.join(dir, "test1");
    await fs.mkdir(boxDir);
    await fs.writeFile(path.join(boxDir, ".cb-box"), JSON.stringify({ version: "1.0.0" }));
    const resolved = await resolveBoxEntry(boxDir);
    assert.equal(resolved.contentDir, boxDir);
    assert.equal(resolved.slug, "test1");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("v2 content dir passed directly: slug comes from the package root basename", async () => {
  const dir = await makeFixtureDir();
  try {
    const pkgRoot = path.join(dir, "test1");
    const contentDir = path.join(pkgRoot, "content");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
    const resolved = await resolveBoxEntry(contentDir);
    assert.equal(resolved.contentDir, contentDir);
    assert.equal(resolved.slug, "test1");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("v2 package root passed directly: contentDir is <entry>/content, slug is entry's basename", async () => {
  const dir = await makeFixtureDir();
  try {
    const pkgRoot = path.join(dir, "test1");
    const contentDir = path.join(pkgRoot, "content");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
    const resolved = await resolveBoxEntry(pkgRoot);
    assert.equal(resolved.contentDir, contentDir);
    assert.equal(resolved.slug, "test1");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("nonexistent path: tolerated as a legacy fallback (basename slug, entry as contentDir)", async () => {
  const resolved = await resolveBoxEntry("/nonexistent/somewhere/test1");
  assert.equal(resolved.contentDir, "/nonexistent/somewhere/test1");
  assert.equal(resolved.slug, "test1");
});

test("boxEntryToArg formats the server-main.ts argv entry", async () => {
  const dir = await makeFixtureDir();
  try {
    const boxDir = path.join(dir, "test1");
    await fs.mkdir(boxDir);
    await fs.writeFile(path.join(boxDir, ".cb-box"), "");
    const resolved = await resolveBoxEntry(boxDir);
    assert.equal(boxEntryToArg(resolved), `test1=${boxDir}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("resolveBoxEntry: a present but malformed .cb-box marker fails closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "box-entry-"));
  try {
    const contentDir = path.join(dir, "pkg", "content");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, ".cb-box"), JSON.stringify({ shapeVersion: "2" }));
    await assert.rejects(resolveBoxEntry(contentDir), BoxMarkerError);
    await fs.writeFile(path.join(contentDir, ".cb-box"), "{not json");
    await assert.rejects(resolveBoxEntry(contentDir), BoxMarkerError);
    // The empty marker is the pre-JSON convention and still means legacy.
    await fs.writeFile(path.join(contentDir, ".cb-box"), "");
    assert.equal((await resolveBoxEntry(contentDir)).slug, "content");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

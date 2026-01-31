/**
 * Tests for box operations.
 */

import { test } from "tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox, isValidBox, getBoxMetadata } from "../src/core/box.js";
import { findBoxRoot, BOX_MARKER } from "../src/cli/lib/paths.js";

test("initBox creates directory structure", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    await initBox(tmpDir, { skipGit: true });

    // Check marker file
    const markerPath = path.join(tmpDir, BOX_MARKER);
    const marker = await fs.readFile(markerPath, "utf-8");
    const metadata = JSON.parse(marker);
    t.equal(metadata.version, "1.0.0");
    t.ok(metadata.created);

    // Check directories exist
    const dirs = [
      "box/inbox",
      "box/questions",
      "box/commands",
      "box/resources",
      "store/archive/done",
      "store/archive/failed",
      "store/archive/processed",
      "store/trash",
      "config",
      "config/connectors",
      "config/schemas",
      ".claude",
      ".claude/rules",
    ];

    for (const dir of dirs) {
      const stat = await fs.stat(path.join(tmpDir, dir));
      t.ok(stat.isDirectory(), `${dir} should be a directory`);
    }

    // Check gitignore
    const gitignore = await fs.readFile(path.join(tmpDir, ".gitignore"), "utf-8");
    t.ok(gitignore.includes(".cb-lock"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("isValidBox returns true for valid box", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    await initBox(tmpDir, { skipGit: true });
    t.equal(await isValidBox(tmpDir), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("isValidBox returns false for non-box", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    t.equal(await isValidBox(tmpDir), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("findBoxRoot finds box root from subdirectory", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    await initBox(tmpDir, { skipGit: true });

    const subDir = path.join(tmpDir, "box", "inbox");
    const found = await findBoxRoot(subDir);

    t.equal(found, tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("getBoxMetadata returns metadata", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    await initBox(tmpDir, { skipGit: true });
    const metadata = await getBoxMetadata(tmpDir);

    t.ok(metadata);
    t.equal(metadata?.version, "1.0.0");
    t.ok(metadata?.created);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("initBox fails on existing box", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-test-"));

  try {
    await initBox(tmpDir, { skipGit: true });

    // Try to init again
    await t.rejects(
      initBox(tmpDir, { skipGit: true }),
      /already a callback box/
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

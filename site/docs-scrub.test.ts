import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { resetScrubCacheForTests, scrubText, ScrubError } from "./docs-scrub.js";

// Built by concatenation so this file never contains a matchable `/Users/<name>/`
// literal — the repo's path-leak-check scans test files too.
const REAL_HOME = ["", "Users", "janedoe", ""].join("/");

function tmpRepoRoot(blocklist?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-scrub-"));
  if (blocklist !== undefined) fs.writeFileSync(path.join(dir, ".commit-blocklist"), blocklist);
  resetScrubCacheForTests();
  return dir;
}

test("scrubText: a real home path fails naming file:line", () => {
  const repoRoot = tmpRepoRoot();
  assert.throws(
    () => scrubText(`line one\nsee ${REAL_HOME}src/box for the layout\n`, { sourceLabel: "docs/x.md", repoRoot, blocklist: true }),
    (e: unknown) => {
      assert.ok(e instanceof ScrubError);
      assert.equal(e.message, `docs/x.md:2 home path leak: ${REAL_HOME}`);
      return true;
    },
  );
});

test("scrubText: the /Users/me and /Users/you placeholders are allowed", () => {
  const repoRoot = tmpRepoRoot();
  assert.doesNotThrow(() => scrubText("open file:///Users/you/src/boxes/test1\n", { sourceLabel: "docs/x.md", repoRoot, blocklist: true }));
});

test("scrubText: a private-issues reference fails naming file:line", () => {
  const repoRoot = tmpRepoRoot();
  assert.throws(
    () => scrubText("one\ntwo\nsee private-issues/foo.md\n", { sourceLabel: "docs/y.md", repoRoot, blocklist: true }),
    (e: unknown) => {
      assert.ok(e instanceof ScrubError);
      assert.equal(e.message, "docs/y.md:3 references into private-issues");
      return true;
    },
  );
});

test("scrubText: a named box under a boxes directory fails; the test box, tooling folders, and placeholders pass", () => {
  const repoRoot = tmpRepoRoot();
  assert.throws(() => scrubText("bbx boxes add ~/src/boxes/hearthside\n", { sourceLabel: "docs/z.md", repoRoot, blocklist: true }), ScrubError);
  assert.throws(() => scrubText("see /home/beebox/boxes/hearthside/content\n", { sourceLabel: "docs/z.md", repoRoot, blocklist: true }), ScrubError);
  assert.doesNotThrow(() => scrubText("boxes live under ~/src/boxes/\n", { sourceLabel: "docs/z.md", repoRoot, blocklist: true }));
  assert.doesNotThrow(() => scrubText("~/src/boxes/test1 and ~/src/boxes/scenarios/ and ~/src/boxes/<name>\n", { sourceLabel: "docs/z.md", repoRoot, blocklist: true }));
});

test("scrubText: legacy ~/src/boxes/test1 reference passes", () => {
  const repoRoot = tmpRepoRoot();
  assert.doesNotThrow(() => scrubText("boxes live under ~/src/boxes/test1\n", { sourceLabel: "docs/z.md", repoRoot, blocklist: true }));
});

test("scrubText: a .commit-blocklist entry fails naming the blocklist line", () => {
  const repoRoot = tmpRepoRoot("realname\n");
  assert.throws(
    () => scrubText("hello\nsigned, realname\n", { sourceLabel: "docs/w.md", repoRoot, blocklist: true }),
    (e: unknown) => {
      assert.ok(e instanceof ScrubError);
      assert.equal(e.message, "docs/w.md:2 matches .commit-blocklist entry (line 1)");
      return true;
    },
  );
});

test("scrubText: no .commit-blocklist file is a silent no-op for that rule", () => {
  const repoRoot = tmpRepoRoot();
  assert.doesNotThrow(() => scrubText("nothing sensitive here\n", { sourceLabel: "docs/v.md", repoRoot, blocklist: true }));
});

test("scrubText: clean content passes", () => {
  const repoRoot = tmpRepoRoot();
  assert.doesNotThrow(() => scrubText("A box is a directory. It holds cards.\n", { sourceLabel: "docs/clean.md", repoRoot, blocklist: true }));
});

test("scrubText: naming the private-issues boundary passes; a path or link into it fails", () => {
  const repoRoot = tmpRepoRoot();
  const opts = { sourceLabel: "docs/p.md", repoRoot, blocklist: true };
  assert.doesNotThrow(() => scrubText("Follow the root's `private-issues/` boundary.\n", opts));
  assert.doesNotThrow(() => scrubText("Private issues live in private-issues (a separate repo).\n", opts));
  assert.throws(() => scrubText("see private-issues/bugs/x.md\n", opts), ScrubError);
  assert.throws(() => scrubText("[the note](../private-issues/x.md)\n", opts), ScrubError);
});


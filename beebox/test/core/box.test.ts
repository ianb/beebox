// # Box Initialization
//
// `scaffoldBoxRoot` creates a shapeVersion-3 box: the npm-package half
// (`package.json`, `tsconfig.json`, `src/`) and the operational half
// (the underscore areas) both scaffolded at the ONE root. `initBox` creates the
// operational directory structure at that root. `isValidBox` checks if a
// directory is a properly initialized box. `findBoxRoot` walks up to find the
// box root.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not } from "@ianbicking/tap-check/check";
import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isValidBox, getBoxMetadata, initBox } from "../../src/core/box/structure/core.js";
import { scaffoldBoxRoot } from "../../src/core/box/package.js";
import { findBoxRoot, BOX_MARKER } from "../../src/lib/paths/core.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-test-"));
}

async function listDirs(root: string) {
  const result: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        result.push(rel);
        await walk(path.join(dir, e.name), rel);
      }
    }
  }
  await walk(root, "");
  result.sort();
  return result.join("\n");
}

// ## Directory structure
//
// A fresh v3 box's operational tree lives right at `boxRoot` (which is also
// the npm-package root). We filter to just the operational (underscore) areas
// here — `src/`, `.claude/`, `.beebox/`, and `node_modules/` are the code/agent
// side, covered by their own tests:
void test("A fresh v3 box's operational tree lives right at boxRoot (which is also the n...", async (t) => {
  const tmp = await makeTmpDir();
  const { boxRoot } = await scaffoldBoxRoot(tmp);
  const allDirs = (await listDirs(boxRoot)).split("\n");
  await t.checkText(allDirs.filter((d) => d.startsWith("_")).join("\n"), `_bookkeeping
_bookkeeping/archive
_bookkeeping/archive/done
_bookkeeping/archive/failed
_bookkeeping/archive/processed
_bookkeeping/connectors
_bookkeeping/jobs
_bookkeeping/output
_bookkeeping/procedure
_bookkeeping/procedure/runs
_bookkeeping/questions
_bookkeeping/resources
_bookkeeping/trash
_bookkeeping/usage
_config
_config/connectors
_config/feedback
_config/interface
_config/procedures
_config/schedules
_config/schemas
_content
_content/calendar
_content/chat
_content/drive
_content/inbox
_content/inbox/intake
_content/inbox/staged
_content/inbox/triaged
_content/inbox/triaged/_unsure
_content/inbox/unhandled
_content/incoming
_content/people
_content/places
_content/recipes
_content/reviews
_content/reviews/retro
_content/todos
_publish
_tmp`);

  // The box marker file contains version metadata:

  const marker = JSON.parse(await fs.readFile(path.join(boxRoot, BOX_MARKER), "utf-8"));
  t.check(marker, { version: "1.0.0", shapeVersion: 3, created: isoDate() });

  // A properly initialized directory is recognized as a valid box:

  t.check(await isValidBox(boxRoot), true);
});

// ## Validation
//
// An empty directory is not a valid box:
void test("An empty directory is not a valid box:", async (t) => {
  const empty = await makeTmpDir();
  t.check(await isValidBox(empty), false);
});

// ## Finding the box root
//
// `findBoxRoot` walks up from any subdirectory to find the nearest box root:
void test("findBoxRoot walks up from any subdirectory to find the nearest box root:", async (t) => {
  const tmp = await makeTmpDir();
  const { boxRoot } = await scaffoldBoxRoot(tmp);
  const found = await findBoxRoot(path.join(boxRoot, "_content", "inbox"));
  t.check(found, boxRoot);

  // An unrelated directory — no `.beebox/box.json` anywhere upward — fails closed with `null`, not a guess:

  const unrelatedDir = await makeTmpDir();
  t.check(await findBoxRoot(unrelatedDir), null);
});

// ## Metadata and idempotent initialization
//
// `getBoxMetadata` reads the marker file. Running `initBox` again preserves the original created timestamp:
void test("getBoxMetadata reads the marker file.", async (t) => {
  const tmp = await makeTmpDir();
  const { boxRoot } = await scaffoldBoxRoot(tmp);
  const meta1 = await getBoxMetadata(boxRoot);
  assert.ok(meta1);
  t.check(meta1, { version: "1.0.0", created: isoDate() });

  await initBox(boxRoot, { skipGit: true });
  const meta2 = await getBoxMetadata(boxRoot);
  assert.ok(meta2);
  t.check(meta2, meta1);

  t.check(await isValidBox(boxRoot), true);
});

// ## Asset tracking: manifest scheme vs git-annex
//
// `initBox` rewrites `.gitignore` and `.gitattributes` on every run. There is one
// form of each: every box is annex-shaped, so asset bytes inside `.attach/` scopes
// are always *visible* to `git add` — that is how they reach the annex — and the
// manifest scheme's ignore block is never written.
//
// `.gitattributes` carries no `filter=lfs` rules either. Git LFS is retired, and
// the rules were dead config that only risked re-LFS-ifying a box's new media.
void test("initBox rewrites .gitignore and .gitattributes on every run.", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmp = await makeTmpDir();
  const { boxRoot } = await scaffoldBoxRoot(tmp);
  const gitignore = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
  const gitattributes = await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8");
  // Generated files: narrow checks on the lines that matter.
  t.check(gitignore, not(any(String).includes("**/*.attach/**/*.pdf")));
  t.check(gitignore, any(String).includes("managed by bbx attachments unignore"));
  t.check(gitignore, any(String).includes("**/tmp-capture/**/*.attach/**"));
  t.check(gitattributes, not(any(String).includes("filter=lfs")));

  // Capture staging stays ignored — a capture is pre-triage and gets rewritten
  // before it is filed.
  //
  // It is idempotent: a second `initBox` leaves both files byte-identical, so
  // `bbx init` never dirties an existing box's working tree.

  await initBox(boxRoot, { skipGit: true });
  t.check(await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8"), gitignore);
  t.check(await fs.readFile(path.join(boxRoot, ".gitattributes"), "utf-8"), gitattributes);
});

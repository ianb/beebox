// # Staged unlisted binaries (the commit-time guard)
//
// The pre-commit guard reads the **index**, not the tree: bytes enter history only
// via staged blobs, so this fires at exactly the commit that would embed them and
// scales with the commit rather than the box. The box-wide walk
// (`unlisted-binaries.ts`) stays for `bbx doctor annex` / `attachments verify`. See
// `src/core/annex/staged-unlisted.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  findStagedUnlistedBinaries,
  describeStagedUnlistedBinaries,
} from "../../../src/core/annex/staged-unlisted.js";
import { UNLISTED_BINARY_LIMIT_BYTES } from "../../../src/core/annex/unlisted-binaries.js";

/** Write a file of `size` bytes into the box, creating parent dirs. */
async function put({ root, relPath, size }: { root: string; relPath: string; size: number }): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.alloc(size, 7));
}

const BIG = UNLISTED_BINARY_LIMIT_BYTES + 1;

// A large unlisted file sitting in an attach scope is invisible to this check
// until it is **staged** — that is the whole point of moving off the tree walk:
// pre-existing debris stops blocking unrelated commits.
void test("A large unlisted file sitting in an attach scope is invisible to this check u...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  const box = await makeTmpBox({ git: true });
  await put({ root: box.root, relPath: "notes.attach/export.parquet", size: BIG });
  await t.checkText((await findStagedUnlistedBinaries(box.root)).length, "0");

  // Staging it makes it a blocking finding:

  // doctest:L44
  execSync("git add -A", { cwd: box.root });
  const found = await findStagedUnlistedBinaries(box.root);
  t.check(found.map((f) => `${f.relPath} .${f.extension} allowlisted=${String(f.allowlisted)}`), [
    "notes.attach/export.parquet .parquet allowlisted=false",
  ]);

  // The report names both remedies, since which one is right is a judgment the
  // reader has to make:

  // doctest:L57
  const report = describeStagedUnlistedBinaries(found);
  t.check(
    [
      report.includes("Either add the extension to ASSET_EXTENSIONS"),
      report.includes("or confirm the file belongs in git"),
    ],
    [
    true,
    true,
  ],
  );

  // Small files, control files (a card, a manifest), and files outside any attach
  // scope are never flagged — attach scopes legitimately hold committed text, and
  // flagging it would train everyone to ignore the check:

  // doctest:L73
  await put({ root: box.root, relPath: "notes.attach/accounts.csv", size: 58 * 1024 });
  await put({ root: box.root, relPath: "notes.attach/photo-001.image.card", size: BIG });
  await put({ root: box.root, relPath: "notes.attach/manifest.json", size: BIG });
  await put({ root: box.root, relPath: "store/dump.parquet", size: BIG });
  execSync("git add -A", { cwd: box.root });
  t.check((await findStagedUnlistedBinaries(box.root)).map((f) => f.relPath), [
    "notes.attach/export.parquet",
  ]);

  // A non-ASCII filename is still sized and flagged. This is what the `-z` flag in
  // `listStagedRelPaths` buys: without it git C-quotes such a path
  // (`core.quotePath`), `git cat-file` then reports the quoted name "missing", and
  // a large binary with a unicode name would slip through a guard that exists to
  // fail closed:

  // doctest:L92
  await put({ root: box.root, relPath: "notes.attach/日記スキャン.parquet", size: BIG });
  execSync("git add -A", { cwd: box.root });
  t.check((await findStagedUnlistedBinaries(box.root)).map((f) => f.relPath).toSorted(), [
    "notes.attach/export.parquet",
    "notes.attach/日記スキャン.parquet",
  ]);
});

// ## Allowlisted extension staged as raw bytes
//
// Sizing the staged blob rather than the working file catches a case the
// extension-allowlist walk waved through: an annexed extension whose **bytes**
// were staged, meaning git-annex is not filtering it. (In a correctly configured
// box the staged blob is a small pointer, so a real annexed asset passes here at
// any working-file size.)
//
// The misconfiguration has to be built deliberately, because a box is annexed and
// correctly configured from creation — `annex.largefiles` is cleared so the
// filter claims nothing, which is precisely the state the detector exists to
// catch. It used to arise for free from a manifest-scheme fixture; that is no
// longer a state a box can be in.
void test("Sizing the staged blob rather than the working file catches a case the extens...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L121
  const box = await makeTmpBox({ git: true });
  execSync("git config annex.largefiles nothing", { cwd: box.root });
  await put({ root: box.root, relPath: "trip.attach/beach.jpg", size: BIG });
  execSync("git add -A", { cwd: box.root });
  const found = await findStagedUnlistedBinaries(box.root);
  t.check(found.map((f) => `${f.relPath} allowlisted=${String(f.allowlisted)}`), [
    "trip.attach/beach.jpg allowlisted=true",
  ]);

  // It is reported as the misconfiguration it is, not as a missing allowlist entry:

  // doctest:L136
  const report = describeStagedUnlistedBinaries(found);
  t.check(
    [
      report.includes("staged as RAW BYTES"),
      report.includes("bbx doctor annex"),
      report.includes("Either add the extension to ASSET_EXTENSIONS"),
    ],
    [
    true,
    true,
    false,
  ],
  );
});

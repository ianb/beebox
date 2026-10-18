// # Unlisted binaries in attach scopes
//
// `ASSET_EXTENSIONS` is an allowlist, and an allowlist's failure mode is
// omission — a new binary type lands in an attach scope, matches nothing, and its
// bytes go into git history. That is how 41 MB `page.frozen` snapshots got
// committed before 2026-07-19. This scan makes the next omission loud. See
// `src/core/annex/unlisted-binaries.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import {
  findUnlistedBinaries,
  describeUnlistedBinaries,
  UNLISTED_BINARY_LIMIT_BYTES,
} from "../../../src/core/annex/unlisted-binaries.js";

/** Write a file of `size` bytes into a scope, creating the scope. */
async function put({ root, relPath, size }: { root: string; relPath: string; size: number }): Promise<void> {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.alloc(size, 7));
}

const BIG = UNLISTED_BINARY_LIMIT_BYTES + 1;

// A large unlisted file is reported. This is the `.frozen` case: nothing about
// `.parquet` is in the allowlist, so `git add` would commit its bytes directly.
void test("A large unlisted file is reported.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L33
  const box = await makeTmpBox();
  await put({ root: box.root, relPath: "notes.attach/export.parquet", size: BIG });
  const found = await findUnlistedBinaries(box.root);
  t.check(found.map((f) => `${f.relPath} .${f.extension}`).join(", "), "notes.attach/export.parquet .parquet");

  // Listed asset types are not reported at any size — they will be annexed, which
  // is the whole point:

  // doctest:L44
  await put({ root: box.root, relPath: "notes.attach/photo.jpg", size: BIG });
  await put({ root: box.root, relPath: "notes.attach/scan.pdf", size: BIG });
  await t.checkText((await findUnlistedBinaries(box.root)).length, "1");

  // Small unlisted files are ignored. Attach scopes legitimately hold committed
  // text — cards, manifests, email bodies, `.csv` exports — and flagging those
  // would train everyone to ignore the check:

  // doctest:L55
  await put({ root: box.root, relPath: "notes.attach/accounts.csv", size: 58 * 1024 });
  await put({ root: box.root, relPath: "notes.attach/msg-001.body.txt", size: 2000 });
  await t.checkText((await findUnlistedBinaries(box.root)).length, "1");

  // Control files are skipped regardless of size — a card or manifest belongs in
  // git no matter how large it grows:

  // doctest:L65
  await put({ root: box.root, relPath: "notes.attach/photo-001.image.card", size: BIG });
  await put({ root: box.root, relPath: "notes.attach/manifest.json", size: BIG });
  await t.checkText((await findUnlistedBinaries(box.root)).length, "1");

  // The report names both remedies, since which one is right is a judgment the
  // reader has to make:

  // doctest:L75
  const report = describeUnlistedBinaries(await findUnlistedBinaries(box.root));
  await t.checkText(report.includes("Either add the extension to ASSET_EXTENSIONS") && report.includes("or confirm the file belongs in git"), "true");

  // Assets in a plain **subdirectory** of a scope are found too. An email's
  // `attachments/` folder is the common shape, and a direct-children-only scan
  // would let exactly those through:

  // doctest:L85
  await put({ root: box.root, relPath: "mail.attach/attachments/archive.parquet", size: BIG });
  t.check((await findUnlistedBinaries(box.root)).map((f) => f.relPath).toSorted().join(", "), "mail.attach/attachments/archive.parquet, notes.attach/export.parquet");
});

// An unreadable scope is an **error**, not an empty result. This guard blocks
// commits, so a scan that silently skips what it cannot read would let the
// already-staged blob through while reporting success:
void test("An unreadable scope is an error, not an empty result.", async (t) => {
  // doctest:L99
  const box2 = await makeTmpBox();
  await put({ root: box2.root, relPath: "locked.attach/big.parquet", size: BIG });
  await fs.chmod(box2.path("locked.attach"), 0o000);
  const outcome = await findUnlistedBinaries(box2.root).then(
    () => "reported clean",
    (e: unknown) => (e instanceof Error ? e.name : "non-error"),
  );
  await fs.chmod(box2.path("locked.attach"), 0o755);
  t.check(outcome, "UnlistedScanIncompleteError");

  // doctest:L110
  await box2.cleanup();
});

// A box with no attach scopes at all scans clean rather than erroring:
void test("A box with no attach scopes at all scans clean rather than erroring:", async (t) => {
  // doctest:L116
  const empty = await makeTmpBox();
  await t.checkText((await findUnlistedBinaries(empty.root)).length, "0");

  // doctest:L120
  await empty.cleanup();
});

// Files git ignores are not reported: git never commits them, so their bytes
// cannot reach history. A publication card's buildable project keeps
// `node_modules/` and a `dist/` build inside its attach scope, and the box
// `.gitignore` covers both. The same large file in `static/`, which is committed,
// is still reported:
void test("Files git ignores are not reported:", async (t) => {
  // doctest:L130
  const pub = await makeTmpBox();
  await put({ root: pub.root, relPath: "_content/trips/Site.attach/project/node_modules/pkg/bundle.wasm-blob", size: BIG });
  await put({ root: pub.root, relPath: "_content/trips/Site.attach/project/dist/app.bundle", size: BIG });
  await put({ root: pub.root, relPath: "_content/trips/Site.attach/static/app.bundle", size: BIG });
  t.check((await findUnlistedBinaries(pub.root)).map((f) => f.relPath).join(", "), "_content/trips/Site.attach/static/app.bundle");

  // doctest:L137
  await pub.cleanup();
});

// Outside a git repository nothing is ignored, so every candidate is kept:
void test("Outside a git repository nothing is ignored, so every candidate is kept:", async (t) => {
  // doctest:L143
  const bare = await makeTmpBox({ git: "none" });
  await put({ root: bare.root, relPath: "Site.attach/project/dist/app.bundle", size: BIG });
  t.check((await findUnlistedBinaries(bare.root)).map((f) => f.relPath).join(", "), "Site.attach/project/dist/app.bundle");

  // doctest:L148
  await bare.cleanup();
});

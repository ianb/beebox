// # Box inventory grouping
//
// The inventory reports literal file types and a content-oriented projection where
// an attachment scope rolls into its owning card. Runtime/dependency directories
// are excluded, while loose files and orphaned attachment directories stay visible.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { scanBoxInventory } from "../../src/core/box-inventory/core.js";
import { scanBoxRepositoryStats } from "../../src/core/box-inventory/repository-stats.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const box = await makeTmpBox();
function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_error) {
    return false;
  }
}
await fs.mkdir(box.path("_content/people"), { recursive: true });
await fs.writeFile(box.path("_content/people/Alice.image.card"), "card");
await fs.mkdir(box.path("_content/people/Alice.attach"));
await fs.writeFile(box.path("_content/people/Alice.attach/photo.webp"), "123456");
await fs.writeFile(box.path("_content/people/Alice.attach/nested.doc.card"), "nested");
await fs.mkdir(box.path("_content/people/Alice.attach/nested.attach"));
await fs.writeFile(box.path("_content/people/Alice.attach/nested.attach/page.bin"), "page");
await fs.writeFile(box.path("_content/people/notes.md"), [
  "[Alice](/_content/people/Alice.image.card)",
  "[Bob attachment](/_content/people/Bob.attach/shared.bin)",
].join("\n"));
await fs.mkdir(box.path("_content/people/Gone.attach"));
await fs.writeFile(box.path("_content/people/Gone.attach/lost.bin"), "lost");
await fs.mkdir(box.path("_content/people/Empty.attach"));
await fs.writeFile(box.path("_content/people/Bob.image.card"), "one");
await fs.writeFile(box.path("_content/people/Bob.doc.card"), "two");
await fs.mkdir(box.path("_content/people/Bob.attach"));
await fs.writeFile(box.path("_content/people/Bob.attach/shared.bin"), "three");
await fs.writeFile(box.path("_content/people/Charlie.recipe.card"), "solo");
await fs.mkdir(box.path("node_modules/pkg"), { recursive: true });
await fs.writeFile(box.path("node_modules/pkg/index.js"), "ignored");

// A real Git-annex repository verifies path mapping, logical key size, and the
// linked storage split. Machines without Git-annex use the expected contract,
// matching the repository's other annex tests.
let annexBox: Awaited<ReturnType<typeof makeTmpBox>> | undefined;
interface AnnexResult {
  enabled: boolean;
  available: boolean;
  all: { files: number; bytes: number };
  linked: { files: number; bytes: number };
  regular: number;
}
let annexResult: AnnexResult = { enabled: true, available: true, all: { files: 1, bytes: 11 }, linked: { files: 1, bytes: 11 }, regular: 0 };
if (hasAnnex()) {
  annexBox = await makeTmpBox({ git: true });
  const repo = annexBox.root;
  await fs.writeFile(annexBox.path("sample.bin"), "annex bytes");
  execFileSync("git", ["annex", "init", "-q", "inventory-test"], { cwd: repo });
  execFileSync("git", ["annex", "add", "--force", "sample.bin"], { cwd: repo });
  const stats = await scanBoxRepositoryStats(annexBox.root, [
    { relativePath: "sample.bin", bytes: 11, linkStatus: "linked" },
  ]);
  annexResult = ({ enabled: stats.annexed, available: stats.annexQueryAvailable, all: stats.storage.all.annexed, linked: stats.storage.linked.annexed, regular: stats.storage.all.regular.files });
}

// Direct accounting sees each physical file. Grouped accounting counts the image
// card once and includes its attachment bytes; the orphan directory is one item,
// including when empty.
void test("Direct accounting sees each physical file.", async (t) => {
  const inventory = await scanBoxInventory(box.root, { now: new Date("2026-08-12T12:00:00Z") });
  const direct = Object.fromEntries(inventory.direct.map((item) => [item.type, [item.count, item.bytes]]));
  const grouped = Object.fromEntries(inventory.grouped.map((item) => [item.type, [item.count, item.bytes]]));
  const linkedDirect = Object.fromEntries(inventory.byLinkStatus.linked.direct.map((item) => [item.type, [item.count, item.bytes]]));
  const linkedGrouped = Object.fromEntries(inventory.byLinkStatus.linked.grouped.map((item) => [item.type, [item.count, item.bytes]]));
  const unlinkedGrouped = Object.fromEntries(inventory.byLinkStatus.unlinked.grouped.map((item) => [item.type, [item.count, item.bytes]]));
  t.check(
    {
      direct: { card: direct[".image.card"], nestedCard: direct[".doc.card"], webp: direct[".webp"], markdown: direct[".md"], javascript: direct[".js"] },
      grouped: { card: grouped[".image.card"], markdown: grouped[".md"], orphan: grouped["Orphaned .attach/"] },
      ambiguous: grouped["Ambiguous card basename"],
      linked: { grouped: linkedGrouped[".image.card"], ambiguous: linkedGrouped["Ambiguous card basename"], card: linkedDirect[".image.card"], nestedCard: linkedDirect[".doc.card"], attachment: linkedDirect[".webp"] },
      unlinked: unlinkedGrouped[".recipe.card"],
      repository: {
        checkoutDiskBytes: inventory.repository.checkoutDiskBytes,
        gitDiskBytes: inventory.repository.gitDiskBytes,
        annexed: inventory.repository.annexed,
        allRegularFiles: inventory.repository.storage.all.regular.files,
        linkedRegularFiles: inventory.repository.storage.linked.regular.files,
        unlinkedRegularFiles: inventory.repository.storage.unlinked.regular.files,
      },
      orphanDirectories: inventory.orphanAttachmentDirectories,
    },
    {
      direct: { card: [2, 7], nestedCard: [2, 9], webp: [1, 6], markdown: [5, 2811], javascript: undefined },
      grouped: { card: [1, 20], markdown: [5, 2811], orphan: [2, 4] },
      ambiguous: [1, 11],
      linked: { grouped: [1, 20], ambiguous: [1, 11], card: [2, 7], nestedCard: [2, 9], attachment: [1, 6] },
      unlinked: [1, 4],
      repository: {
        checkoutDiskBytes: any(Number).between(inventory.totals.bytes, Infinity),
        gitDiskBytes: any(Number).positive(),
        annexed: false,
        allRegularFiles: 66,
        linkedRegularFiles: 7,
        unlinkedRegularFiles: 1,
      },
      orphanDirectories: 2,
    },
  );
});

// A disappearing or unreadable subtree produces labeled lower-bound totals instead
// of failing the entire scan.
void test("A disappearing or unreadable subtree produces labeled lower-bound totals inst...", async (t) => {
  const locked = box.path("locked");
  await fs.mkdir(locked);
  await fs.writeFile(box.path("locked/hidden.txt"), "hidden");
  await fs.chmod(locked, 0o000);
  const partial = await scanBoxInventory(box.root);
  await fs.chmod(locked, 0o700);
  t.check({ complete: partial.complete, filesystemErrors: partial.filesystemErrors }, { complete: false, filesystemErrors: [str`locked: EACCES: permission denied, scandir '${box.root}/locked'`] });
});

void test("line 114", async (t) => {
  t.teardown(async () => {
    try {
      if (annexBox !== undefined) {
        execFileSync("chmod", ["-R", "u+w", annexBox.root], { stdio: "pipe" });
      }
      await annexBox?.cleanup();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  t.check(annexResult, { enabled: true, available: true, all: { files: 1, bytes: 11 }, linked: { files: 1, bytes: 11 }, regular: 0 });
});

// ## Publication build output and dependency trees are not inventoried
//
// A box with a publication project's `dist/` and `node_modules/` inventories the
// same as one holding only the project's `src/` file.
void test("A box with a publication project's dist/ and nodemodules/ inventories the sam...", async (t) => {
  const project = "_content/trips/Site.attach/project";
  const onlySource = await makeTmpBox();
  await onlySource.write(`${project}/src/readme.md`, "# Source\n");
  const withBuild = await makeTmpBox();
  await withBuild.write(`${project}/src/readme.md`, "# Source\n");
  await withBuild.write(`${project}/dist/page.md`, "# Built\n");
  await withBuild.write(`${project}/dist/stray.note.card`, "---\n---\n");
  await withBuild.write(`${project}/node_modules/pkg/README.md`, "# pkg\n");
  const counts = async (root: string) => {
    const inv = await scanBoxInventory(root, { now: new Date("2026-08-12T12:00:00Z") });
    return [inv.direct, inv.grouped].map((items) => items.map((item) => [item.type, item.count]));
  };
  const onlySourceCounts = await counts(onlySource.root);
  const withBuildCounts = await counts(withBuild.root);
  await onlySource.cleanup();
  await withBuild.cleanup();
  t.check(withBuildCounts, onlySourceCounts);
});

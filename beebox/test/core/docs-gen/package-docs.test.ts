// # Package docs: beebox's reference docs live in the package, not the box
//
// `engineDocs()` (`src/core/docs-gen/package-docs/core.ts`) computes every reference
// doc about the engine itself — the static reference docs, one `card-<type>.md`
// per built-in schema with `instructions`, and a `README.md` index — from the
// running source alone. `ensurePackageDocs()` writes them into
// `<packageRoot>/box-docs/` when the content fingerprint on disk differs, so a
// box never carries a copy and the docs can never lag the engine that reads them.
// Design: `docs/plans/box-docs-in-package.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing, not } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, readFile, readdir, chmod, rm, writeFile } from "node:fs/promises";
import { writeBoxCardDocs } from "../../../src/core/docs-gen/box-docs.js";
import { cardSchema } from "../../../src/exports/cards.js";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { engineDocs, ensurePackageDocs, engineDocFilenames, replaceDirContents } from "../../../src/core/docs-gen/package-docs/core.js";
import { BOX_PACKAGE_DOCS } from "../../../src/core/docs-gen/shared.js";
import { cardSchemas } from "../../../src/schemas.js";

const docs = engineDocs();
const byName = new Map(docs.map((d) => [d.filename, d.content]));

// ## Every built-in schema with instructions has a doc, and the index lists every doc
void test("Every built-in schema with instructions has a doc, and the index lists every doc", async (t) => {
  const withInstructions = cardSchemas.list.filter((s) => s.instructions !== undefined);
  t.check(withInstructions.map((s) => `card-${s.type}.md`).filter((name) => !byName.has(name)), []);

  const index = byName.get("README.md") ?? "";
  // One index row per doc (every doc but the index itself): the list is the docs missing a row.
  t.check(docs.filter((d) => d.filename !== "README.md" && !index.includes(`| \`${d.filename}\` |`)).map((d) => d.filename), []);

  // The index tells the agent where it is from a box. The index is a large generated text, so the check is narrow.
  t.check(index, any(String).includes(BOX_PACKAGE_DOCS));

  // Package docs never carry a per-box DOCID marker
  t.check(docs.filter((d) => d.content.includes("DOCID:")).map((d) => d.filename), []);

  // Prose docs from docs/box/ ship with their frontmatter stripped and their read-when in the index
  const prose = byName.get("what-you-could-do.md") ?? "";
  t.check(prose, not(any(String).startsWith("---")));

  t.check(index, any(String).matches(/\| `what-you-could-do\.md` \| \S/));
});

// ## A card doc uses only built-in templates and carries the contains: appendix for searchable types
void test("A card doc uses only built-in templates and carries the contains: appendix for searchable types", async (t) => {
  const searchable = cardSchemas.list.find((s) => s.searchable && s.instructions !== undefined);
  // A large generated doc: the appendix heading is the narrow check.
  t.check(byName.get(`card-${searchable?.type}.md`), any(String).includes("## The `contains:` field"));
});

// ## ensurePackageDocs writes once, then reports current; a changed fingerprint rewrites
void test("ensurePackageDocs writes once, then reports current; a changed fingerprint rewrites", async (t) => {
  const packageRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-"));
  const first = await ensurePackageDocs({ packageRoot });
  t.check(first, { status: "written", dir: join(packageRoot, "box-docs") });

  const second = await ensurePackageDocs({ packageRoot });
  t.check(second, { status: "current" });

  // Every doc landed, plus the fingerprint file; no temp sibling was left behind
  const files = (await readdir(join(packageRoot, "box-docs"))).toSorted();
  t.check(files, containing(["README.md", ".hash", "card-doc.md"]));

  t.check(await readdir(packageRoot), ["box-docs"]);

  // The filenames the box pruner uses are exactly what the package holds
  t.check(files.filter((f) => f !== ".hash").toSorted(), engineDocFilenames().toSorted());

  await rm(packageRoot, { recursive: true, force: true });
});

// ## An unwritable package root is reported, not thrown
void test("An unwritable package root is reported, not thrown", async (t) => {
  const readOnlyRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-ro-"));
  await chmod(readOnlyRoot, 0o500);
  const blocked = await ensurePackageDocs({ packageRoot: readOnlyRoot });
  const blockedDir = join(readOnlyRoot, "box-docs");
  t.check(blocked, { status: "unwritable", dir: blockedDir, reason: `EACCES writing ${blockedDir}` });

  await chmod(readOnlyRoot, 0o700);
  await rm(readOnlyRoot, { recursive: true, force: true });
});

// ## Concurrent ensures in one process share a single write
void test("Concurrent ensures in one process share a single write", async (t) => {
  const sharedRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-race-"));
  const results = await Promise.all([
    ensurePackageDocs({ packageRoot: sharedRoot }),
    ensurePackageDocs({ packageRoot: sharedRoot }),
    ensurePackageDocs({ packageRoot: sharedRoot }),
  ]);
  const sharedDir = join(sharedRoot, "box-docs");
  t.check(results, [
    { status: "written", dir: sharedDir },
    { status: "written", dir: sharedDir },
    { status: "written", dir: sharedDir },
  ]);

  // One live directory, no temp or old siblings left behind
  t.check(await readdir(sharedRoot), ["box-docs"]);

  await rm(sharedRoot, { recursive: true, force: true });
});

// ## Where the directory cannot be renamed, its contents are replaced in place
//
// In a container, the engine's `box-docs/` comes from an image layer, and
// overlayfs refuses to rename such a directory (EXDEV). `swapIn` then falls back
// to `replaceDirContents`: stale files go, new ones arrive, the fingerprint is
// written last, and the temp directory is removed.
void test("In a container, the engine's box-docs/ comes from an image layer, and overlay...", async (t) => {
  const layerRoot = await mkdtemp(join(tmpdir(), "bbx-pkgdocs-exdev-"));
  const live = join(layerRoot, "box-docs");
  const incoming = join(layerRoot, ".box-docs-new");
  await mkdir(live);
  await mkdir(incoming);
  await writeFile(join(live, "stale.md"), "old");
  await writeFile(join(live, "README.md"), "old index");
  await writeFile(join(live, ".hash"), "old\n");
  await writeFile(join(incoming, "README.md"), "new index");
  await writeFile(join(incoming, "card-doc.md"), "doc");
  await writeFile(join(incoming, ".hash"), "new\n");
  await replaceDirContents({ from: incoming, to: live });

  t.check((await readdir(live)).toSorted(), [".hash", "README.md", "card-doc.md"]);

  t.check([await readFile(join(live, "README.md"), "utf-8"), (await readFile(join(live, ".hash"), "utf-8")).trim()], ["new index", "new"]);

  t.check(await readdir(layerRoot), ["box-docs"]);

  await rm(layerRoot, { recursive: true, force: true });
});

// ## The box writer prunes old engine docs first, so a shadowing box-local doc survives
//
// An older engine wrote every engine doc into the box's `_content/docs/generated/`.
// `writeBoxCardDocs` removes those (they live in the package now) and then writes
// the box-local card docs — in that order, so a box-local schema that shadows a
// built-in type (`doc` here) keeps its doc where the agent guide points.
void test("An older engine wrote every engine doc into the box's content/docs/generated/.", async (t) => {
  const boxRoot = await mkdtemp(join(tmpdir(), "bbx-boxdocs-"));
  const docsDir = join(boxRoot, "_content/docs/generated");
  await mkdir(docsDir, { recursive: true });
  await writeFile(join(docsDir, "bbx-commands.md"), "old engine doc");
  await writeFile(join(docsDir, "card-doc.md"), "old built-in card doc");
  await writeFile(join(docsDir, "intake-guide.md"), "compiled from this box");

  const boxDoc = cardSchema("doc", {
    description: "this box's doc",
    category: "authored",
    fields: { title: z.string() },
    instructions: "How THIS box writes docs.",
  });
  await writeBoxCardDocs({ boxRoot, boxCardSchemas: [boxDoc], boxTemplates: [] });

  t.check((await readdir(docsDir)).toSorted(), ["card-doc.md", "intake-guide.md"]);

  // A generated card doc: the box's own instructions text is the narrow check.
  t.check(await readFile(join(docsDir, "card-doc.md"), "utf-8"), any(String).includes("How THIS box writes docs."));

  await rm(boxRoot, { recursive: true, force: true });
});

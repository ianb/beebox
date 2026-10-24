// # search: index lifecycle — build, refresh, move, recover
//
// `openSearchIndex` restores the persisted Orama index, diffs the manifest
// against the filesystem, re-extracts only what changed, and persists when
// dirty. The index is a disposable cache: corruption or version mismatch
// rebuilds silently.

import { test } from "tap";
import "@ianbicking/tap-check/tap";

import { search } from "@orama/orama";
import { rename, writeFile } from "node:fs/promises";
import { openSearchIndex } from "../../../src/core/search/refresh/core.js";
import { searchIndexPath, searchLockPath, type SearchIndex } from "../../../src/core/search/store/core.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function find(db: SearchIndex, term: string): Promise<string> {
  const result = await search(db, { term, properties: ["title", "contains", "content"] });
  return result.hits.map((h) => String(h.document.path)).toSorted().join("\n");
}

const DOC = (text: string, contains?: string) =>
  `---\ntitle: Note\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;

// ## Build: searchable cards index, operational kinds don't
void test("Build: searchable cards index, operational kinds don't", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved to June 17.", "Dentist moved to June 17."));
  await box.write("_content/notes/Budget.doc.card", DOC("Quarterly budget review notes."));
  await box.write("_bookkeeping/jobs/job-1.intake-job.card", "---\nstatus: pending\n---\nTriage the dentist email\n");
  await box.write("_bookkeeping/trash/Old.doc.card", DOC("trashed dentist note"));
  const opened = await openSearchIndex(box.root);
  t.check({ warnings: opened.warnings, stale: opened.stale }, { warnings: [], stale: false });

  t.check(await find(opened.db, "dentist"), "_content/inbox/Dentist.doc.card");

  t.check(await find(opened.db, "budget"), "_content/notes/Budget.doc.card");

  // ## Incremental refresh: edits and new cards picked up at next open

  await box.write("_content/inbox/Dentist.doc.card", DOC("Now it is an orthodontist appointment on June 19."));
  await box.write("_content/notes/Garden.doc.card", DOC("Plant the tomatoes after the last frost."));
  const reopened = await openSearchIndex(box.root);
  t.check(await find(reopened.db, "orthodontist"), "_content/inbox/Dentist.doc.card");

  t.check(await find(reopened.db, "tomatoes"), "_content/notes/Garden.doc.card");

  t.check(await find(reopened.db, "dentist"), "");

  // ## A moved card re-indexes under its new path

  await rename(box.path("_content/notes/Budget.doc.card"), box.path("_content/notes/Budget_2026.doc.card"));
  const moved = await openSearchIndex(box.root);
  t.check(await find(moved.db, "budget"), "_content/notes/Budget_2026.doc.card");

  // ## Persist → restore is stable (pins oramasearch/orama#695 at our version)

  const before = await find((await openSearchIndex(box.root)).db, "tomatoes");
  const after = await find((await openSearchIndex(box.root)).db, "tomatoes");
  t.check(before, "_content/notes/Garden.doc.card");

  t.check(after, "_content/notes/Garden.doc.card");

  // ## A corrupted index file rebuilds silently

  await writeFile(searchIndexPath(box.root), "not a real index");
  const recovered = await openSearchIndex(box.root);
  t.check(await find(recovered.db, "tomatoes"), "_content/notes/Garden.doc.card");

  // ## Lock contention serves the last persisted index, flagged stale

  await acquireLock(searchLockPath(box.root), { purpose: "test" });
  const blocked = await openSearchIndex(box.root, { lockRetries: 2, lockRetryMs: 10 });
  t.check(blocked.stale, true);

  t.check(await find(blocked.db, "tomatoes"), "_content/notes/Garden.doc.card");

  await releaseLock(searchLockPath(box.root));
  t.check((await openSearchIndex(box.root)).stale, false);

  // ## An unparseable card is skipped with a warning; everything else still works

  await box.write("_content/notes/Broken.doc.card", "---\ntitle: [unclosed\n---\nbroken body\n");
  const withBad = await openSearchIndex(box.root);
  t.check(withBad.warnings, [
    "_content/notes/Broken.doc.card: skipped (invalid YAML frontmatter: unexpected end of the stream within a flow collection (2:1)\n\n 1 | title: [unclosed\n 2 | \n-----^)",
  ]);

  t.check(await find(withBad.db, "tomatoes"), "_content/notes/Garden.doc.card");

  // An unchanged broken card warns once, not on every search.
  t.check((await openSearchIndex(box.root)).warnings, []);

  await box.write("_content/notes/Broken.doc.card", DOC("fixed broken body"));
  const fixedAgain = await openSearchIndex(box.root);
  t.check(fixedAgain.warnings, []);

  t.check(await find(fixedAgain.db, "broken"), "_content/notes/Broken.doc.card");

  // ## Standalone .md files index as kind "markdown"; attach-scope files don't

  await box.write("_content/finances/Distribution_Letter.md", "# Ledger Distribution Letter\n\nEach heir receives an apportioned share.\n");
  await box.write("_content/notes/Note.attach/snippet.md", "apportioned share duplicate inside attach scope");
  await box.write("_content/docs/generated/card-doc.md", "apportioned share generated doc noise");
  const withMd = await openSearchIndex(box.root);
  t.check(await find(withMd.db, "apportioned share"), "_content/finances/Distribution_Letter.md");

  const mdHit = await search(withMd.db, { term: "distribution letter", properties: ["title", "content"] });
  const mdDoc = mdHit.hits[0]?.document;
  t.check({ path: mdDoc?.path, kind: mdDoc?.kind, title: mdDoc?.title, contains: mdDoc?.contains, content: mdDoc?.content }, {
    path: "_content/finances/Distribution_Letter.md",
    kind: "markdown",
    title: "Ledger Distribution Letter",
    contains: "",
    content: "# Ledger Distribution Letter\n\nEach heir receives an apportioned share.",
  });

  // ## The engine's package docs index as kind "engine-doc"
  //
  // The one directory under `node_modules` the walker covers is the installed
  // package's `box-docs/`, so an agent finds "how does beebox do X" by content.
  // Other package files (source, other markdown) stay out.

  await box.write("node_modules/beebox/box-docs/views.md", "# Views\n\nA view exports rendersCardTypes to attach itself to a card type.\n");
  await box.write("node_modules/beebox/box-docs/nested/ignored.md", "rendersCardTypes mentioned in a nested dir");
  await box.write("node_modules/beebox/README.md", "rendersCardTypes mentioned in the package readme");
  const withDocs = await openSearchIndex(box.root);
  t.check(await find(withDocs.db, "rendersCardTypes"), "node_modules/beebox/box-docs/views.md");

  const docHit = await search(withDocs.db, { term: "rendersCardTypes", properties: ["content"] });
  const engineDoc = docHit.hits[0]?.document;
  t.check({ path: engineDoc?.path, kind: engineDoc?.kind, title: engineDoc?.title, contains: engineDoc?.contains, content: engineDoc?.content }, {
    path: "node_modules/beebox/box-docs/views.md",
    kind: "engine-doc",
    title: "Views",
    contains: "",
    content: "# Views\n\nA view exports rendersCardTypes to attach itself to a card type.",
  });

  // ## Gdoc snapshots are watched input files: editing only the attachment re-indexes

  await box.write(
    "_content/drive/Notes.gdoc.card",
    "---\ndrive:\n  id: d1\n  link: https://docs.google.com/document/d/d1/edit\n  owner: o@example.com\n  modified: 2026-05-01\ntitle: Project Notes\ncontent:\n  ref: attach/Notes.md\n---\n"
  );
  await box.write("_content/drive/Notes.attach/Notes.md", "Planning the lighthouse migration.");
  const withGdoc = await openSearchIndex(box.root);
  t.check(await find(withGdoc.db, "lighthouse"), "_content/drive/Notes.gdoc.card");

  await box.write("_content/drive/Notes.attach/Notes.md", "Planning the submarine migration instead.");
  const inputChanged = await openSearchIndex(box.root);
  t.check(await find(inputChanged.db, "submarine"), "_content/drive/Notes.gdoc.card");

  t.check(await find(inputChanged.db, "lighthouse"), "");
});

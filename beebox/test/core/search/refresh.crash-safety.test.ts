// # search: index-before-manifest crash safety
//
// The refresh persists the index first and the manifest last, so a crash between
// the two writes leaves an *older* manifest — never a manifest describing docs the
// index doesn't hold. The next refresh re-diffs the stale manifest against the
// filesystem and re-extracts the affected files, self-healing. The ordering is
// enforced by the type system: `saveManifest` requires the `IndexPersisted`
// receipt that only `persistSearchIndex` (or `indexUnchanged`) mints.

import { test } from "tap";
import "agent-doctest/tap";
import { search } from "@orama/orama";
import { readFile, writeFile } from "node:fs/promises";
import { openSearchIndex } from "../../../src/core/search/refresh/core.js";
import { saveManifest, emptyManifest } from "../../../src/core/search/refresh/manifest.js";
import {
  searchManifestPath,
  persistSearchIndex,
  indexUnchanged,
  createSearchIndex,
  type SearchIndex,
} from "../../../src/core/search/store/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { toError } from "../../../src/shared/error-guards.js";

async function find(db: SearchIndex, term: string): Promise<string> {
  const result = await search(db, { term, properties: ["title", "content"] });
  return result.hits.map((h) => String(h.document.path)).toSorted().join("\n");
}

const DOC = (text: string) => `---\ntitle: Note\n---\n${text}\n`;

async function throwName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return toError(e).name;
  }
}

// ## A crash that leaves an older manifest self-heals on next refresh
//
// Build an index over one card and snapshot the manifest that describes it.
void test("Build an index over one card and snapshot the manifest that describes it.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L46
  const box = await makeTmpBox();
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment is on June 17."));
  await openSearchIndex(box.root);
  const staleManifest = await readFile(searchManifestPath(box.root), "utf8");
  await t.checkText(staleManifest.includes("Dentist.doc.card"), "true");

  // Edit that card and add another, then refresh so both the index and the manifest
  // now reflect the new state.

  // doctest:L58
  await box.write("_content/inbox/Dentist.doc.card", DOC("Rescheduled to an orthodontist on June 19."));
  await box.write("store/notes/Garden.doc.card", DOC("Plant the tomatoes after the frost."));
  const fresh = await openSearchIndex(box.root);
  t.check(await find(fresh.db, "orthodontist"), "_content/inbox/Dentist.doc.card");

  // doctest:L64
  t.check(await find(fresh.db, "tomatoes"), "store/notes/Garden.doc.card");

  // Now simulate a crash *between* the index write and the manifest write: the index
  // on disk is the new one, but the manifest was rolled back to the pre-edit
  // snapshot (the write never landed). The next open re-diffs the stale manifest and
  // re-extracts — the healed index reflects the true filesystem, with no warnings.

  // doctest:L74
  await writeFile(searchManifestPath(box.root), staleManifest);
  const healed = await openSearchIndex(box.root);
  t.check(healed.warnings, []);

  // doctest:L79
  t.check(await find(healed.db, "orthodontist"), "_content/inbox/Dentist.doc.card");

  // doctest:L82
  t.check(await find(healed.db, "tomatoes"), "store/notes/Garden.doc.card");

  // doctest:L85
  t.check(
    // The pre-edit content is gone — the stale manifest didn't resurrect it.
    // ("appointment" appears only in the old body, not the rescheduled one.)
    await find(healed.db, "appointment"),
    "",
  );
});

// ## A first refresh whose only change is a skipped card doesn't throw
//
// The very first refresh over a box whose sole indexable file fails to parse hits
// the manifest-only branch (a skip record, no docs) with no persisted index yet.
// That must complete and warn about the skip — not crash asserting a missing index.
void test("The very first refresh over a box whose sole indexable file fails to parse hi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L102
  const box = await makeTmpBox();
  await box.write("store/notes/Broken.doc.card", "---\ntitle: [unclosed\n---\nbroken body\n");
  const opened = await openSearchIndex(box.root);
  await t.checkText(opened.warnings.length, "1");

  // doctest:L108
  t.check(opened.warnings[0]?.startsWith("store/notes/Broken.doc.card: skipped"), true);

  // doctest:L111
  // A valid card added later indexes fine on top of the recorded skip.
  await box.write("store/notes/Good.doc.card", DOC("the garden tomatoes are ripe"));
  const withGood = await openSearchIndex(box.root);
  t.check(await find(withGood.db, "tomatoes"), "store/notes/Good.doc.card");
});

// ## The receipt makes writing the manifest ahead of the index unrepresentable
//
// `saveManifest` cannot be called without an `IndexPersisted` receipt, and the
// receipt is checked against the box it's used for — a receipt minted for another
// box is rejected loudly rather than persisting a mismatched manifest.
void test("saveManifest cannot be called without an IndexPersisted receipt, and the rece...", async (t) => {
  t.teardown(async () => {
    try {
      await boxA.cleanup();
      await boxB.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L129
  const boxA = await makeTmpBox();
  const boxB = await makeTmpBox();
  const proofB = await persistSearchIndex(await createSearchIndex(), boxB.root);
  t.check(await throwName(() => saveManifest(boxA.root, { manifest: emptyManifest(), indexProof: proofB })), "InvariantError");

  // `indexUnchanged` mints the receipt for a no-document-change refresh (only
  // stat/mtime or skip records moved) — including a first refresh whose only
  // "change" is a skipped card, where no index file exists yet. It is accepted by
  // `saveManifest` for its own box.

  // doctest:L142
  t.check(await saveManifest(boxA.root, { manifest: emptyManifest(), indexProof: indexUnchanged(boxA.root) }), undefined);
});

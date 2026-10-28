// # Loading view cards
//
// `loadViewCards(boxRoot, dependencies)` resolves a view's dependency globs to the
// cards and files it renders — the same data the `/api/views/:slug/cards` route
// serves. It additionally reports cards that matched a glob but failed to load
// (`skipped`), which the route drops but `bbx view check` surfaces.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { loadViewCards } from "../../../src/core/views/cards.js";

const DOC_CARD = `---
title: Test
---
Test doc content
`;

// ## Cards and files
//
// A dependency glob selecting a card returns it as a `ViewCard`, with non-card
// matches arriving in `files` as metadata:
void test("A dependency glob selecting a card returns it as a ViewCard, with non-card ma...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Test.doc.card", DOC_CARD);
  await box.write("_content/inbox/Test.attach/notes.txt", "hello");
  await fs.utimes(box.path("_content/inbox/Test.attach/notes.txt"), 1_700_000_000, 1_700_000_000);

  const result = await loadViewCards(box.root, ["_content/**/*.card", "_content/**/*.txt"]);
  const notes = {
    path: "_content/inbox/Test.attach/notes.txt",
    size: 5,
    mtimeMs: 1_700_000_000_000,
    etag: 'W/"loyw3v28-5"',
    gitStatus: "untracked",
  } as const;
  // `bodyLineOffset` counts the file lines before the body, from the same split
  // the todo collector uses, so a todo a view renders through `Markdown` gets the
  // collector's locator. The doc's frontmatter block is three lines.
  t.check(result, {
    cards: [
      {
        path: "_content/inbox/Test.doc.card",
        type: "doc",
        frontmatter: { title: "Test" },
        bodyLineOffset: 3,
        body: "Test doc content\n",
        attachments: [notes],
      },
    ],
    files: [notes],
    skipped: [],
  });
});

// ## No dependencies
//
// A view with no dependency globs loads nothing:
void test("A view with no dependency globs loads nothing:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const result = await loadViewCards(box.root, []);
  t.check(result, {
    cards: [],
    files: [],
    skipped: [],
  });
});

// ## Skipped-card diagnostics
//
// A card that matches a glob but fails to load (here: an unknown card type with no
// registered schema) is omitted from `cards` and reported in `skipped` with its
// path and the load error — so a test command can tell the author their dependency
// selected an invalid card instead of silently rendering without it:
void test("A card that matches a glob but fails to load (here:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Good.doc.card", DOC_CARD);
  await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema for this type\n");

  const result = await loadViewCards(box.root, ["_content/**/*.card"]);
  t.check({ paths: result.cards.map((c) => c.path), skipped: result.skipped }, {
    paths: ["_content/inbox/Good.doc.card"],
    skipped: [
      {
        path: "_content/inbox/Bad.bogus.card",
        error: `${box.root}/_content/inbox/Bad.bogus.card: not a recognized card: no frontmatter block with a registered type`,
      },
    ],
  });
});

// ## Round-7 hardening finding 2: a box-wide glob never reaches package internals
//
// `**/*.doc.card` from the unified root would otherwise reach a package-internal
// `src/private.doc.card` too — a dependency is box CONTENT by definition, so
// every glob's root is restricted to the underscore areas before it ever
// matches:
void test("/.doc.card from the unified root would otherwise reach a package-internal src...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Real.doc.card", DOC_CARD);
  await box.write("src/private.doc.card", DOC_CARD);

  const result = await loadViewCards(box.root, ["**/*.doc.card"]);
  t.check(result.cards.map((c) => c.path), ["_content/inbox/Real.doc.card"]);
});

// ## An escaping leaf symlink is dropped, not served
//
// A dependency glob matching INSIDE an underscore area can still name a leaf
// symlink whose target resolves OUTSIDE the box namespace — the match is
// dropped rather than served:
void test("A dependency glob matching INSIDE an underscore area can still name a leaf sy...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-outside-"));
  await fs.writeFile(path.join(outside, "secret.card"), DOC_CARD);
  await fs.mkdir(box.path("_content/inbox"), { recursive: true });
  await fs.symlink(path.join(outside, "secret.card"), box.path("_content/inbox/Escape.doc.card"));
  await box.write("_content/inbox/Real.doc.card", DOC_CARD);

  const result = await loadViewCards(box.root, ["_content/**/*.card"]);
  t.check(result.cards.map((c) => c.path), ["_content/inbox/Real.doc.card"]);
});

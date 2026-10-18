// # Loading view cards
//
// `loadViewCards(boxRoot, dependencies)` resolves a view's dependency globs to the
// cards and files it renders — the same data the `/api/views/:slug/cards` route
// serves. It additionally reports cards that matched a glob but failed to load
// (`skipped`), which the route drops but `bbx view test` surfaces.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
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
  // doctest:L28
  const box = await makeTmpBox();
  await box.write("_content/inbox/Test.doc.card", DOC_CARD);
  await box.write("_content/inbox/Test.attach/notes.txt", "hello");

  // doctest:L32
  const result = await loadViewCards(box.root, ["_content/**/*.card", "_content/**/*.txt"]);
  await t.checkText(result.cards.length, "1");

  // doctest:L36
  t.check(result.cards[0]?.type, "doc");

  // doctest:L39
  t.check(result.cards[0]?.path, "_content/inbox/Test.doc.card");

  // doctest:L42
  t.check(result.cards[0]?.frontmatter?.title, "Test");

  // doctest:L45
  await t.checkText(result.cards[0]?.body, "Test doc content");

  // `bodyLineOffset` counts the file lines before the body, from the same split
  // the todo collector uses, so a todo a view renders through `Markdown` gets the
  // collector's locator. The doc's frontmatter block is three lines:

  // doctest:L54
  t.check(result.cards[0]?.bodyLineOffset, 3);

  // doctest:L57
  t.check(result.files.map((f) => f.path).join(", "), "_content/inbox/Test.attach/notes.txt");

  // doctest:L60
  t.check(result.skipped, []);
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
  // doctest:L73
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
  // doctest:L91
  const box = await makeTmpBox();
  await box.write("_content/inbox/Good.doc.card", DOC_CARD);
  await box.write("_content/inbox/Bad.bogus.card", "---\nstatus: new\n---\nno schema for this type\n");

  // doctest:L95
  const result = await loadViewCards(box.root, ["_content/**/*.card"]);
  t.check(result.cards.map((c) => c.path).join(", "), "_content/inbox/Good.doc.card");

  // doctest:L99
  t.check(result.skipped.map((s) => s.path).join(", "), "_content/inbox/Bad.bogus.card");

  // doctest:L102
  await t.checkText((result.skipped[0]?.error.length ?? 0) > 0, "true");
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
  // doctest:L118
  const box = await makeTmpBox();
  await box.write("_content/inbox/Real.doc.card", DOC_CARD);
  await box.write("src/private.doc.card", DOC_CARD);

  // doctest:L122
  const result = await loadViewCards(box.root, ["**/*.doc.card"]);
  t.check(result.cards.map((c) => c.path).join(", "), "_content/inbox/Real.doc.card");
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
  // doctest:L138
  const box = await makeTmpBox();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-outside-"));
  await fs.writeFile(path.join(outside, "secret.card"), DOC_CARD);
  await fs.mkdir(box.path("_content/inbox"), { recursive: true });
  await fs.symlink(path.join(outside, "secret.card"), box.path("_content/inbox/Escape.doc.card"));
  await box.write("_content/inbox/Real.doc.card", DOC_CARD);

  // doctest:L145
  const result = await loadViewCards(box.root, ["_content/**/*.card"]);
  t.check(result.cards.map((c) => c.path).join(", "), "_content/inbox/Real.doc.card");
});

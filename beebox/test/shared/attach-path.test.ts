// # Attach Path Helpers
//
// Helpers for the `.attach/` directory convention. Every card may have a sibling directory named `<basename>.attach/`. Refs from the card to its attached files use the virtual prefix `attach/<file>`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  cardBasename,
  attachDirFor,
  attachmentPath,
  isAttachRef,
  splitAttachRef,
  resolveAttachRef,
  isLiteralAttachName,
  isAttachDirName,
  attachDirOwnerBasename,
  isInsideAttachScope,
  isPublicationBuildOutputPath,
} from "../../src/shared/attach-path.js";

// ## cardBasename
//
// Strips `.<type>.card` to return the card's basename. Works on both filenames and full paths.
void test("Strips .<type>.card to return the card's basename.", async (t) => {
  // doctest:L26
  t.check(cardBasename("Foo.image.card"), "Foo");

  // doctest:L29
  t.check(cardBasename("/box/inbox/Foo.image.card"), "Foo");

  // doctest:L32
  t.check(cardBasename("Project.Notes.doc.card"), "Project.Notes");
});

// Inputs that don't follow the convention are returned unchanged.
void test("Inputs that don't follow the convention are returned unchanged.", async (t) => {
  // doctest:L39
  t.check(cardBasename("notes.txt"), "notes.txt");

  // doctest:L42
  t.check(cardBasename("nofile.card"), "nofile");
});

// ## attachDirFor
//
// Returns the path of a card's attach scope — `<basename>.attach` in the same directory as the card.
void test("Returns the path of a card's attach scope — <basename>.attach in the same dir...", async (t) => {
  // doctest:L51
  t.check(attachDirFor("inbox/Foo.image.card"), "inbox/Foo.attach");

  // doctest:L54
  t.check(attachDirFor("/box/inbox/scan-001.capture-session.card"), "/box/inbox/scan-001.attach");

  // doctest:L57
  t.check(attachDirFor("Foo.doc.card"), "Foo.attach");
});

// ## attachmentPath
//
// Computes a file path inside a card's attach scope.
void test("Computes a file path inside a card's attach scope.", async (t) => {
  // doctest:L66
  t.check(attachmentPath("inbox/Foo.image.card", "photo-001.jpg"), "inbox/Foo.attach/photo-001.jpg");
});

// Nested paths inside the scope work too.
void test("Nested paths inside the scope work too.", async (t) => {
  // doctest:L73
  t.check(attachmentPath("inbox/Foo.email-message.card", "attachments/quarterly.pdf"), "inbox/Foo.attach/attachments/quarterly.pdf");
});

// ## isAttachRef and splitAttachRef
//
// A ref uses the `attach/` virtual prefix when it starts with `attach/` (or is exactly `attach`).
void test("A ref uses the attach/ virtual prefix when it starts with attach/ (or is exac...", async (t) => {
  // doctest:L82
  t.check(isAttachRef("attach/photo-001.jpg"), true);

  // doctest:L85
  t.check(isAttachRef("attach"), true);
});

// Mid-path `.attach` and other patterns are NOT recognized as attach refs.
void test("Mid-path .attach and other patterns are NOT recognized as attach refs.", async (t) => {
  // doctest:L92
  t.check(isAttachRef("store/x.attach/y.jpg"), false);

  // doctest:L95
  t.check(isAttachRef("photo-001.jpg"), false);

  // doctest:L98
  t.check(isAttachRef("./attach/photo.jpg"), false);
});

// `splitAttachRef` returns the portion after the prefix, or `null` for non-attach refs.
void test("splitAttachRef returns the portion after the prefix, or null for non-attach r...", async (t) => {
  // doctest:L105
  t.check(splitAttachRef("attach/photo-001.jpg"), "photo-001.jpg");

  // doctest:L108
  t.check(splitAttachRef("attach/sub/scan.image.card"), "sub/scan.image.card");

  // doctest:L111
  t.check(splitAttachRef("attach"), "");

  // doctest:L114
  t.check(splitAttachRef("store/x.attach/y.jpg"), null);
});

// ## resolveAttachRef
//
// Expands a ref that uses the `attach/` prefix to a path against a card's attach scope.
void test("Expands a ref that uses the attach/ prefix to a path against a card's attach...", async (t) => {
  // doctest:L123
  t.check(resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg"), "inbox/Foo.attach/photo-001.jpg");

  // doctest:L126
  t.check(resolveAttachRef("inbox/Foo.email-message.card", "attach/attachments/foo.pdf"), "inbox/Foo.attach/attachments/foo.pdf");

  // doctest:L129
  t.check(resolveAttachRef("Foo.doc.card", "attach"), "Foo.attach");

  // doctest:L132
  t.check(resolveAttachRef("Foo.doc.card", "store/some/path.jpg"), null);
});

// ## isLiteralAttachName and isAttachDirName
//
// Used by lint rules.
void test("Used by lint rules.", async (t) => {
  // doctest:L141
  t.check(isLiteralAttachName("attach"), true);

  // doctest:L144
  t.check(isLiteralAttachName("attachments"), false);

  // doctest:L147
  t.check(isLiteralAttachName("Foo.attach"), false);
});

// A directory name ends with `.attach` when it's a card's attach scope.
void test("A directory name ends with .attach when it's a card's attach scope.", async (t) => {
  // doctest:L154
  t.check(isAttachDirName("Foo.attach"), true);

  // doctest:L157
  t.check(isAttachDirName(".attach"), false);

  // doctest:L160
  t.check(isAttachDirName("attach"), false);
});

// `attachDirOwnerBasename` returns the basename of the card that owns a given attach directory, or `null` if the directory isn't an attach scope.
void test("attachDirOwnerBasename returns the basename of the card that owns a given att...", async (t) => {
  // doctest:L167
  t.check(attachDirOwnerBasename("Foo.attach"), "Foo");

  // doctest:L170
  t.check(attachDirOwnerBasename("attachments"), null);

  // doctest:L173
  t.check(attachDirOwnerBasename("attach"), null);
});

// ## isInsideAttachScope
//
// Recognizes paths nested anywhere inside any attach scope.
void test("Recognizes paths nested anywhere inside any attach scope.", async (t) => {
  // doctest:L182
  t.check(isInsideAttachScope("inbox/Foo.attach/photo.jpg"), true);

  // doctest:L185
  t.check(isInsideAttachScope("inbox/Foo.attach/scan.image.attach/photo.jpg"), true);

  // doctest:L188
  t.check(isInsideAttachScope("inbox/Foo.doc.card"), false);

  // doctest:L191
  t.check(isInsideAttachScope("store/regular/path/file.txt"), false);
});

// ## Publication build output
//
// A path at or below `<name>.attach/project/dist` is a publication project's
// build output; box walkers skip it. Other `dist` segments are ordinary content.
void test("A path at or below <name>.attach/project/dist is a publication project's buil...", async (t) => {
  // doctest:L201
  t.check(
    [
      "_content/a/X.attach/project/dist",
      "_content/a/X.attach/project/dist/sub/f.js",
      "_content/a/X.attach/static/dist/f.js",
      "_content/a/project/dist/f.js",
      "_content/a/X.attach/project/src/dist.ts",
    ].map(isPublicationBuildOutputPath),
    [
    true,
    true,
    false,
    false,
    false,
  ],
  );
});

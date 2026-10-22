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
  t.check(cardBasename("Foo.image.card"), "Foo");

  t.check(cardBasename("/box/inbox/Foo.image.card"), "Foo");

  t.check(cardBasename("Project.Notes.doc.card"), "Project.Notes");
});

// Inputs that don't follow the convention are returned unchanged.
void test("Inputs that don't follow the convention are returned unchanged.", async (t) => {
  t.check(cardBasename("notes.txt"), "notes.txt");

  t.check(cardBasename("nofile.card"), "nofile");
});

// ## attachDirFor
//
// Returns the path of a card's attach scope — `<basename>.attach` in the same directory as the card.
void test("Returns the path of a card's attach scope — <basename>.attach in the same dir...", async (t) => {
  t.check(attachDirFor("inbox/Foo.image.card"), "inbox/Foo.attach");

  t.check(attachDirFor("/box/inbox/scan-001.capture-session.card"), "/box/inbox/scan-001.attach");

  t.check(attachDirFor("Foo.doc.card"), "Foo.attach");
});

// ## attachmentPath
//
// Computes a file path inside a card's attach scope.
void test("Computes a file path inside a card's attach scope.", async (t) => {
  t.check(attachmentPath("inbox/Foo.image.card", "photo-001.jpg"), "inbox/Foo.attach/photo-001.jpg");
});

// Nested paths inside the scope work too.
void test("Nested paths inside the scope work too.", async (t) => {
  t.check(attachmentPath("inbox/Foo.email-message.card", "attachments/quarterly.pdf"), "inbox/Foo.attach/attachments/quarterly.pdf");
});

// ## isAttachRef and splitAttachRef
//
// A ref uses the `attach/` virtual prefix when it starts with `attach/` (or is exactly `attach`).
void test("A ref uses the attach/ virtual prefix when it starts with attach/ (or is exac...", async (t) => {
  t.check(isAttachRef("attach/photo-001.jpg"), true);

  t.check(isAttachRef("attach"), true);
});

// Mid-path `.attach` and other patterns are NOT recognized as attach refs.
void test("Mid-path .attach and other patterns are NOT recognized as attach refs.", async (t) => {
  t.check(isAttachRef("store/x.attach/y.jpg"), false);

  t.check(isAttachRef("photo-001.jpg"), false);

  t.check(isAttachRef("./attach/photo.jpg"), false);
});

// `splitAttachRef` returns the portion after the prefix, or `null` for non-attach refs.
void test("splitAttachRef returns the portion after the prefix, or null for non-attach r...", async (t) => {
  t.check(splitAttachRef("attach/photo-001.jpg"), "photo-001.jpg");

  t.check(splitAttachRef("attach/sub/scan.image.card"), "sub/scan.image.card");

  t.check(splitAttachRef("attach"), "");

  t.check(splitAttachRef("store/x.attach/y.jpg"), null);
});

// ## resolveAttachRef
//
// Expands a ref that uses the `attach/` prefix to a path against a card's attach scope.
void test("Expands a ref that uses the attach/ prefix to a path against a card's attach...", async (t) => {
  t.check(resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg"), "inbox/Foo.attach/photo-001.jpg");

  t.check(resolveAttachRef("inbox/Foo.email-message.card", "attach/attachments/foo.pdf"), "inbox/Foo.attach/attachments/foo.pdf");

  t.check(resolveAttachRef("Foo.doc.card", "attach"), "Foo.attach");

  t.check(resolveAttachRef("Foo.doc.card", "store/some/path.jpg"), null);
});

// ## isLiteralAttachName and isAttachDirName
//
// Used by lint rules.
void test("Used by lint rules.", async (t) => {
  t.check(isLiteralAttachName("attach"), true);

  t.check(isLiteralAttachName("attachments"), false);

  t.check(isLiteralAttachName("Foo.attach"), false);
});

// A directory name ends with `.attach` when it's a card's attach scope.
void test("A directory name ends with .attach when it's a card's attach scope.", async (t) => {
  t.check(isAttachDirName("Foo.attach"), true);

  t.check(isAttachDirName(".attach"), false);

  t.check(isAttachDirName("attach"), false);
});

// `attachDirOwnerBasename` returns the basename of the card that owns a given attach directory, or `null` if the directory isn't an attach scope.
void test("attachDirOwnerBasename returns the basename of the card that owns a given att...", async (t) => {
  t.check(attachDirOwnerBasename("Foo.attach"), "Foo");

  t.check(attachDirOwnerBasename("attachments"), null);

  t.check(attachDirOwnerBasename("attach"), null);
});

// ## isInsideAttachScope
//
// Recognizes paths nested anywhere inside any attach scope.
void test("Recognizes paths nested anywhere inside any attach scope.", async (t) => {
  t.check(isInsideAttachScope("inbox/Foo.attach/photo.jpg"), true);

  t.check(isInsideAttachScope("inbox/Foo.attach/scan.image.attach/photo.jpg"), true);

  t.check(isInsideAttachScope("inbox/Foo.doc.card"), false);

  t.check(isInsideAttachScope("store/regular/path/file.txt"), false);
});

// ## Publication build output
//
// A path at or below `<name>.attach/project/dist` is a publication project's
// build output; box walkers skip it. Other `dist` segments are ordinary content.
void test("A path at or below <name>.attach/project/dist is a publication project's buil...", async (t) => {
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

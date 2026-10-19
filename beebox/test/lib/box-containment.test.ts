// # Box path containment for card refs
//
// `containWithinBox` and the ref resolvers keep a card ref — a value written by a
// human, an agent, or injected content — from resolving to a file outside its
// box. A ref that escapes returns `null` and is treated everywhere as a broken
// (nonexistent) ref, never followed.

import { test } from "tap";
import { str } from "@ianbicking/tap-check/check";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import {
  containWithinBox,
  resolveBoxRelativeRef,
  readContainedFile,
  realpathContained,
} from "../../src/lib/box-containment.js";
import { resolveContainedRef } from "../../src/core/ref-exists.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// The expected text of a branded `BoxRelativePath`.
const rel = (path: string) => str`${path}`;

// ## `containWithinBox` — the string floor
//
// A path inside the box returns its box-relative form; the box root itself is `""`.
void test("A path inside the box returns its box-relative form; the box root itself is \"\".", async (t) => {
  // doctest:L26
  t.check(containWithinBox("/box", "/box/_content/x.card"), rel("_content/x.card"));

  // doctest:L29
  t.check(containWithinBox("/box", "/box"), rel(""));
});

// `path.resolve` normalizes `.`, `..`, and trailing separators before the check.
void test("path.resolve normalizes ., .., and trailing separators before the check.", async (t) => {
  // doctest:L36
  t.check(containWithinBox("/box/", "/box/_content/x/"), rel("_content/x"));

  // doctest:L39
  t.check(containWithinBox("/box", "/box/_content/./sub/../x.card"), rel("_content/x.card"));
});

// Escapes — bare and nested `..`, and any absolute path outside — return `null`.
void test("Escapes — bare and nested .., and any absolute path outside — return null.", async (t) => {
  // doctest:L46
  t.check(containWithinBox("/box", "/box/../etc/passwd"), null);

  // doctest:L49
  t.check(containWithinBox("/box", "/box/a/../../etc"), null);

  // doctest:L52
  t.check(containWithinBox("/box", "/etc/passwd"), null);
});

// Prefix collision: a sibling directory sharing the root's name prefix is NOT
// contained (this is why the check is `=== root || startsWith(root + sep)`, never
// a bare `startsWith`).
void test("Prefix collision:", async (t) => {
  // doctest:L61
  t.check(containWithinBox("/box", "/box-evil/secret"), null);

  // doctest:L64
  t.check(containWithinBox("/box", "/boxied"), null);
});

// ## `resolveBoxRelativeRef` — box-root-relative sites
//
// A box-relative ref (or its leading-slash equivalent) resolves against the box
// root; `..` that escapes returns `null`.
void test("A box-relative ref (or its leading-slash equivalent) resolves against the box...", async (t) => {
  // doctest:L74
  t.check(resolveBoxRelativeRef("/box", "_content/inbox/x.card"), rel("_content/inbox/x.card"));

  // doctest:L77
  t.check(resolveBoxRelativeRef("/box", "/_content/inbox/x.card"), rel("_content/inbox/x.card"));

  // doctest:L80
  t.check(resolveBoxRelativeRef("/box", "../etc/passwd"), null);

  // doctest:L83
  t.check(resolveBoxRelativeRef("/box", "a/../../etc/passwd"), null);
});

// ## `resolveContainedRef` — the canonical three forms
//
// Box-root-absolute (`/…`), `attach/…`, and document-relative refs all resolve
// and contain. A legitimate `..` that stays inside the box is allowed.
void test("Box-root-absolute (/…), attach/…, and document-relative refs all resolve and...", async (t) => {
  // doctest:L93
  const from = "/box/_content/inbox/Job.email-message.card";

  // doctest:L95
  t.check(
    // box-root-absolute
    resolveContainedRef({ boxRoot: "/box", ref: "/_content/Foo.card", fromPath: from }),
    rel("_content/Foo.card"),
  );

  // doctest:L99
  t.check(
    // document-relative sibling
    resolveContainedRef({ boxRoot: "/box", ref: "reply.card", fromPath: from }),
    rel("_content/inbox/reply.card"),
  );

  // doctest:L103
  t.check(
    // document-relative parent that stays in the box
    resolveContainedRef({ boxRoot: "/box", ref: "../x.card", fromPath: from }),
    rel("_content/x.card"),
  );

  // doctest:L107
  t.check(
    // attach/ resolves into the card's own attach scope
    resolveContainedRef({ boxRoot: "/box", ref: "attach/photo.jpg", fromPath: "/box/_content/inbox/Foo.image.card" }),
    rel("_content/inbox/Foo.attach/photo.jpg"),
  );
});

// Traversal escapes — including a leading-slash ref that then climbs out —
// return `null`.
void test("Traversal escapes — including a leading-slash ref that then climbs out — retu...", async (t) => {
  // doctest:L116
  t.check(resolveContainedRef({ boxRoot: "/box", ref: "../../../../etc/passwd", fromPath: "/box/_content/inbox/Job.card" }), null);

  // doctest:L119
  t.check(
    // bare ".." from a card at the box root escapes to the parent
    resolveContainedRef({ boxRoot: "/box", ref: "..", fromPath: "/box/Job.card" }),
    null,
  );

  // doctest:L123
  t.check(
    // leading-slash ref is box-root-absolute, but `..` still escapes
    resolveContainedRef({ boxRoot: "/box", ref: "/../etc/passwd", fromPath: "/box/Job.card" }),
    null,
  );
});

// A `?query` or `#fragment` addresses a viewer or a location *within* the target,
// not a different file, so it is split off before resolution (shared with the
// frontend via `src/shared/ref-path/core.ts`). Handing the fragment to the filesystem
// is what used to false-flag `feedback.target.ref`'s documented `path#fragment`
// form as a broken ref.
void test("A ?query or #fragment addresses a viewer or a location within the target, not...", async (t) => {
  // doctest:L135
  const fromCard = "/box/_content/inbox/Job.email-message.card";

  // doctest:L137
  t.check(resolveContainedRef({ boxRoot: "/box", ref: "/_content/Plan.doc.card#risks", fromPath: fromCard }), rel("_content/Plan.doc.card"));

  // doctest:L140
  t.check(resolveContainedRef({ boxRoot: "/box", ref: "sibling.bill.card?view=ledger", fromPath: fromCard }), rel("_content/inbox/sibling.bill.card"));
});

// Refs are filesystem-style, never percent-encoded, so `%2e%2e` is a LITERAL
// directory name — decoding here would be a bug that manufactures traversal.
void test("Refs are filesystem-style, never percent-encoded, so %2e%2e is a LITERAL dire...", async (t) => {
  // doctest:L148
  t.check(resolveContainedRef({ boxRoot: "/box", ref: "%2e%2e/x.card", fromPath: "/box/_content/inbox/Job.card" }), rel("_content/inbox/%2e%2e/x.card"));
});

// ## `readContainedFile` — symlink hardening at the read sink
//
// A legitimate in-box file reads back — even though `makeTmpBox` lives under
// macOS's `/var`→`/private/var` symlink, because `realpath` canonicalizes BOTH
// the box root and the target.
void test("A legitimate in-box file reads back — even though makeTmpBox lives under macO...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L159
  const box = await makeTmpBox();
  await box.write("_content/note.card", "hello from inside");
  const inside = containWithinBox(box.root, box.path("_content/note.card"));
  assert.ok(inside !== null);
  t.check(await readContainedFile(box.root, inside), "hello from inside");

  // An in-box symlink pointing outside passes the string floor (the link sits in
  // the box) but `realpath` follows it: `realpathContained` returns `null` and the
  // read throws. A legitimate in-box file, and a not-yet-existing target, both pass
  // (a missing ref is the caller's to handle, not an escape).

  // doctest:L173
  await symlink("/etc/hosts", box.path("_content/escape.card"));
  const link = containWithinBox(box.root, box.path("_content/escape.card"));
  assert.ok(link !== null);
  t.check(link, rel("_content/escape.card"));

  // doctest:L179
  t.check(await realpathContained(box.root, link), null);

  // doctest:L182
  const err = await readContainedFile(box.root, link).catch((e: unknown) => e);
  t.check(err, {
    name: "RefEscapesBoxError",
    message: "ref resolved outside the box after symlink resolution: _content/escape.card",
    relPath: "_content/escape.card",
  });

  // doctest:L186
  t.check(
    // legit in-box file: returned unchanged
    await realpathContained(box.root, inside),
    rel("_content/note.card"),
  );

  // doctest:L190
  // not-yet-existing in-box target: not an escape, returned unchanged
  const missing = containWithinBox(box.root, box.path("_content/missing.card"));
  assert.ok(missing !== null);
  t.check(await realpathContained(box.root, missing), rel("_content/missing.card"));
});

// # attach-lint: basename collisions and reserved names
//
// `lintAttachLayout` walks a box tree enforcing two rules: no two cards in the
// same directory may share a basename (case-insensitively — see below), and no
// file/directory is literally named `attach` outside an existing
// `<basename>.attach/` scope.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { lintAttachLayout } from "../../src/lib/attach-lint.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## Basenames that only differ by case also collide
//
// macOS (and Windows) filesystems are case-insensitive, so `Foo.doc.card` and
// `foo.doc.card` are the same path on disk even though a case-sensitive string
// comparison would treat them as distinct basenames. The lint compares
// case-insensitively so this is caught before it ever reaches disk.
void test("macOS (and Windows) filesystems are case-insensitive, so Foo.doc.card and foo...", async (t) => {
  t.teardown(async () => {
    try {
      await box2.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box2 = await makeTmpBox();
  await box2.write("Foo.doc.card", "---\ntitle: Note\n---\n");
  await box2.write("foo.record.card", "---\nname: x\n---\n");
  const errors2 = await lintAttachLayout(box2.root);
  const message =
    'Cards in . share basename "Foo": Foo.doc.card, foo.record.card. The shared basename makes <basename>.attach/ ownership ambiguous.';
  t.check(errors2, [
    { path: "Foo.doc.card", rule: "basename-collision", message },
    { path: "foo.record.card", rule: "basename-collision", message },
  ]);
});

// ## Different basenames (or different-case extensions) don't collide
//
// The rule is already extension-insensitive by design (comparing basenames,
// not full filenames) — this stays true alongside the new case-insensitivity.
void test("The rule is already extension-insensitive by design (comparing basenames, not...", async (t) => {
  t.teardown(async () => {
    try {
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box3 = await makeTmpBox();
  await box3.write("Alpha.doc.card", "---\ntitle: Note\n---\n");
  await box3.write("Beta.doc.card", "---\ntitle: Note\n---\n");
  const errors3 = await lintAttachLayout(box3.root);
  t.check(errors3, []);
});

// ## The literal `attach` name is reserved outside an attach scope
void test("The literal `attach` name is reserved outside an attach scope", async (t) => {
  t.teardown(async () => {
    try {
      await box4.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box4 = await makeTmpBox();
  await box4.write("attach/placeholder.txt", "x");
  const errors4 = await lintAttachLayout(box4.root);
  t.check(errors4.map(({ path, rule }) => ({ path, rule })), [{ path: "attach", rule: "literal-attach-name" }]);
});

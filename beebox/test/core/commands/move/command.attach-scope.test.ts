// # `bbx mv` — refs inside the moved card's attach directory
//
// The cards in a moved card's `.attach/` directory moved too. A box-absolute
// ref from one of them to the parent card or to a sibling attachment names the
// old paths, so it is rewritten and keeps its absolute style; a relative ref
// within the folder travelled intact; a ref to a card that stayed put is
// unchanged. The same holds for a rename in place to a new card type, which
// renames the attach directory
// (issues/closed/bugs/2026-11-09-mv-skips-absolute-refs-inside-moved-attach-scope.md).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { executeMove } from "../../../../src/core/commands/move/command.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

/** Move `from` to `to` in a box built from `files`, then show each of `paths` as `>> <path>` and its contents. */
async function moved({ files, args, paths }: { files: Record<string, string>; args: { from: string; to: string }; paths: string[] }) {
  const box = await makeTmpBox();
  try {
    for (const [file, content] of Object.entries(files)) await box.write(file, content);
    const { ctx } = createCollectorContext(box.root);
    const result = await executeMove(ctx, args);
    const out = [result.success ? "success" : `error: ${result.error}`];
    for (const p of paths) out.push(`>> ${p}`, (await box.read(p)).trimEnd());
    return out.join("\n");
  } finally {
    await box.cleanup();
  }
}

const courseFiles = {
  "_content/school/Algebra.course.card": "---\ntype: doc\ntitle: Algebra\n---\nUnits: [one](attach/Unit1.doc.card)\n",
  "_content/school/Algebra.attach/Unit1.doc.card":
    "---\ntype: doc\ntitle: Unit 1\nref: /_content/school/Algebra.course.card\n---\nNext: [two](/_content/school/Algebra.attach/Unit2.doc.card), [also](Unit2.doc.card), [map](/_content/school/Map.doc.card).\n",
  "_content/school/Algebra.attach/Unit2.doc.card": "---\ntype: doc\ntitle: Unit 2\n---\n",
  "_content/school/Algebra.attach/Notes.md": "Parent: [course](/_content/school/Algebra.course.card)\n",
  "_content/school/Map.doc.card": "---\ntype: doc\ntitle: Map\n---\n",
};

void test("Box-absolute refs inside a moved card's attach directory follow a move to another folder", async (t) => {
  await t.checkText(
    await moved({
      files: courseFiles,
      args: { from: "_content/school/Algebra.course.card", to: "_content/school/math/Algebra.course.card" },
      paths: ["_content/school/math/Algebra.attach/Unit1.doc.card", "_content/school/math/Algebra.attach/Notes.md"],
    }),
    `success
>> _content/school/math/Algebra.attach/Unit1.doc.card
---
type: doc
title: Unit 1
ref: /_content/school/math/Algebra.course.card
---
Next: [two](/_content/school/math/Algebra.attach/Unit2.doc.card), [also](Unit2.doc.card), [map](/_content/school/Map.doc.card).
>> _content/school/math/Algebra.attach/Notes.md
Parent: [course](/_content/school/math/Algebra.course.card)`,
  );
});

void test("Box-absolute refs inside a card's attach directory follow a rename to a new card type", async (t) => {
  await t.checkText(
    await moved({
      files: courseFiles,
      args: { from: "_content/school/Algebra.course.card", to: "_content/school/Algebra.dev-course.card" },
      paths: ["_content/school/Algebra.attach/Unit1.doc.card"],
    }),
    `success
>> _content/school/Algebra.attach/Unit1.doc.card
---
type: doc
title: Unit 1
ref: /_content/school/Algebra.dev-course.card
---
Next: [two](/_content/school/Algebra.attach/Unit2.doc.card), [also](Unit2.doc.card), [map](/_content/school/Map.doc.card).`,
  );
});

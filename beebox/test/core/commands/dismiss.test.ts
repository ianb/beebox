// # `bbx dismiss` — decline a pending question
//
// Dismissing sets `dismissed-at` on a pending question, under the same guarded atomic commit as `answer` — but it writes NO
// follow-up job. Only a pending question can be dismissed.

import { test } from "tap";
import "agent-doctest/tap";
import { executeDismiss } from "../../../src/core/commands/dismiss.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import type { TmpBox } from "../../helpers/doctest-helpers.js";

async function dismiss(box: TmpBox, args: Record<string, unknown>) {
  const { ctx } = createCollectorContext(box.root);
  return executeDismiss(ctx, args);
}

const PENDING = `---
prompt: Where does this receipt go?
input:
  type: text
---
`;

// ## Dismisses a pending question, no follow-up job
void test("Dismisses a pending question, no follow-up job", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L28
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Receipt.question.card", PENDING);

  // doctest:L31
  const res = await dismiss(box, { question: "_bookkeeping/questions/Receipt.question.card" });
  t.check(res.success, true);

  // doctest:L35
  const card = await box.read("_bookkeeping/questions/Receipt.question.card");
  await t.checkText(card.includes("dismissed-at:"), "true");

  // No follow-up job is created (dismissal has no directive to execute):

  // doctest:L43
  await t.checkText((await box.list("_bookkeeping/jobs")).includes(".card"), "false");
});

// ## Only a pending question can be dismissed
void test("Only a pending question can be dismissed", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L54
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/Done.question.card",
    // A coherent answered card carries its answer + answered-at (schema-required).
    PENDING.replace(
      "---\n",
      "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Done\n",
    ),
  );

  // doctest:L64
  const res = await dismiss(box, { question: "_bookkeeping/questions/Done.question.card" });
  t.check(res.success, false);

  // doctest:L68
  t.check(res.error, "Question is answered, not pending; only a pending question can be dismissed");
});

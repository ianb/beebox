// # `bbx dismiss` — decline a pending question
//
// Dismissing sets `dismissed-at` on a pending question, under the same guarded atomic commit as `answer` — but it writes NO
// follow-up job. Only a pending question can be dismissed.

import { test } from "tap";
import "agent-doctest/tap";
import { isoDate, str } from "agent-doctest/check";
import { executeDismiss } from "../../../src/core/commands/dismiss.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

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
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Receipt.question.card", PENDING);

  const res = await dismiss(box, { question: "_bookkeeping/questions/Receipt.question.card" });
  t.check(res, { success: true, data: { path: "_bookkeeping/questions/Receipt.question.card" } });

  t.check(await box.read("_bookkeeping/questions/Receipt.question.card"), str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
dismissed-at: ${isoDate()}
---
`);

  // No follow-up job is created (dismissal has no directive to execute):
  t.check(await box.list("_bookkeeping/jobs"), "_bookkeeping/jobs/.gitkeep");
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
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/Done.question.card",
    // A coherent answered card carries its answer + answered-at (schema-required).
    PENDING.replace(
      "---\n",
      "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Done\n",
    ),
  );

  const res = await dismiss(box, { question: "_bookkeeping/questions/Done.question.card" });
  t.check(res, { success: false, error: "Question is answered, not pending; only a pending question can be dismissed" });
});

// # `bbx question reraise` — ask a put-away question again
//
// Clears `dismissed-at` and sets `asked-at` to now: the question is pending
// again and its aging clock restarts. Only a dismissed question without
// `provisional` can be asked again.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { executeQuestionReraise } from "../../../src/core/commands/question-reraise.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

const CARD = "_bookkeeping/questions/Receipt.question.card";

async function reraise(box: TmpBox) {
  const { ctx } = createCollectorContext(box.root);
  return executeQuestionReraise(ctx, { question: CARD });
}

function card(extra: string): string {
  return `---\nprompt: Where does this receipt go?\ninput:\n  type: text\nasked-at: 2026-09-01T09:00:00-07:00\n${extra}---\n`;
}

async function boxWith(content: string) {
  const box = await makeTmpBox({ git: true });
  await box.write(CARD, content);
  return box;
}

// ## A dismissed question becomes pending with a fresh `asked-at`
void test("A dismissed question becomes pending with a fresh `asked-at`", async (t) => {
  const box = await boxWith(card("dismissed-at: 2026-10-01T09:00:00-07:00\n"));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await reraise(box), { success: true, data: { path: CARD } });

  t.check(await box.read(CARD), str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
asked-at: ${isoDate()}
---
`);
});

// ## A pending question is refused
void test("A pending question is refused", async (t) => {
  const box = await boxWith(card(""));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await reraise(box), {
    success: false,
    error: "Question is pending, not dismissed; only a dismissed question can be asked again",
  });
});

// ## An expired question is refused
void test("An expired question is refused", async (t) => {
  const box = await boxWith(card("expired-at: 2026-10-01T09:00:00-07:00\n"));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await reraise(box), {
    success: false,
    error: "Question is expired, not dismissed; only a dismissed question can be asked again",
  });
});

// ## An answered question is refused
void test("An answered question is refused", async (t) => {
  const box = await boxWith(card("answered-at: 2026-10-01T09:00:00-07:00\nanswer:\n  text: Taxes\n"));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await reraise(box), {
    success: false,
    error: "Question is answered, not dismissed; only a dismissed question can be asked again",
  });
});

// ## A dismissed question with `provisional` is refused and left as it was
void test("A dismissed question with `provisional` is refused and left as it was", async (t) => {
  const box = await boxWith(
    card("dismissed-at: 2026-10-01T09:00:00-07:00\nprovisional:\n  decision: Filed it\n  reasoning: Same vendor\n  undo: Move it back\n  decided-at: 2026-10-01T09:00:00-07:00\n"),
  );
  t.teardown(async () => { await box.cleanup(); });
  const before = await box.read(CARD);

  t.check(await reraise(box), {
    success: false,
    error: "Question has a provisional decision; a decided question is not asked again",
  });
  t.check(await box.read(CARD), before);
});

// # `bbx question decide` — record what the box decided in place of an answer
//
// Sets `provisional` on a pending, dismissed, or expired question, and
// `dismissed-at` when it was pending, so a decided question leaves the rotation.
// It never answers: `answered-at` and `answer` stay unset. An answered card and
// a card that already has `provisional` are refused.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import { executeQuestionDecide } from "../../../src/core/commands/question-decide.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { TmpBox } from "../../helpers/test-helpers.js";

const CARD = "_bookkeeping/questions/Receipt.question.card";
const DECISION = { decision: "Filed it under Taxes", reasoning: "Same vendor as last year", undo: "Move it back to the inbox" };

async function decide(box: TmpBox, args: Record<string, unknown>) {
  const { ctx } = createCollectorContext(box.root);
  return executeQuestionDecide(ctx, { question: CARD, ...DECISION, ...args });
}

const PENDING = `---
prompt: Where does this receipt go?
input:
  type: text
---
`;

function withLine(extra: string): string {
  return PENDING.replace("---\n", `---\n${extra}`);
}

async function boxWith(content: string) {
  const box = await makeTmpBox({ git: true });
  await box.write(CARD, content);
  return box;
}

// ## A pending question gets `provisional` and is put away
void test("A pending question gets `provisional` and is put away", async (t) => {
  const box = await boxWith(PENDING);
  t.teardown(async () => { await box.cleanup(); });

  t.check(await decide(box, {}), { success: true, data: { path: CARD } });

  t.check(await box.read(CARD), str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
provisional:
  decision: Filed it under Taxes
  reasoning: Same vendor as last year
  undo: Move it back to the inbox
  decided-at: ${isoDate()}
dismissed-at: ${isoDate()}
---
`);
});

// ## A dismissed question keeps its `dismissed-at`
void test("A dismissed question keeps its `dismissed-at`", async (t) => {
  const box = await boxWith(withLine("dismissed-at: 2026-10-01T09:00:00-07:00\n"));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await decide(box, {}), { success: true, data: { path: CARD } });

  t.check(await box.read(CARD), str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
dismissed-at: 2026-10-01T09:00:00-07:00
provisional:
  decision: Filed it under Taxes
  reasoning: Same vendor as last year
  undo: Move it back to the inbox
  decided-at: ${isoDate()}
---
`);
});

// ## An expired question gets `provisional` and stays expired
void test("An expired question gets `provisional` and stays expired", async (t) => {
  const box = await boxWith(withLine("expired-at: 2026-10-01T09:00:00-07:00\n"));
  t.teardown(async () => { await box.cleanup(); });

  t.check(await decide(box, {}), { success: true, data: { path: CARD } });

  t.check(await box.read(CARD), str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
expired-at: 2026-10-01T09:00:00-07:00
provisional:
  decision: Filed it under Taxes
  reasoning: Same vendor as last year
  undo: Move it back to the inbox
  decided-at: ${isoDate()}
---
`);
});

// ## An answered question is refused
void test("An answered question is refused", async (t) => {
  const box = await boxWith(withLine("answered-at: 2026-10-01T09:00:00-07:00\nanswer:\n  text: Taxes\n"));
  t.teardown(async () => { await box.cleanup(); });
  const before = await box.read(CARD);

  t.check(await decide(box, {}), {
    success: false,
    error: "Question is answered; a decision can be recorded only on a pending, dismissed, or expired question",
  });
  t.check(await box.read(CARD), before);
});

// ## A second decision does not overwrite the first
void test("A second decision does not overwrite the first", async (t) => {
  const box = await boxWith(PENDING);
  t.teardown(async () => { await box.cleanup(); });
  t.check(await decide(box, {}), { success: true, data: { path: CARD } });
  const before = await box.read(CARD);

  t.check(await decide(box, { decision: "Binned it" }), {
    success: false,
    error: "Question already has a provisional decision; it is not overwritten",
  });
  t.check(await box.read(CARD), before);
});

// ## Decision, reasoning, and undo are all required
void test("Decision, reasoning, and undo are all required", async (t) => {
  const box = await boxWith(PENDING);
  t.teardown(async () => { await box.cleanup(); });

  t.check(await decide(box, { decision: "" }), { success: false, error: "--decision is required" });
  t.check(await decide(box, { reasoning: undefined }), { success: false, error: "--reasoning is required" });
  t.check(await decide(box, { undo: " " }), { success: false, error: "--undo is required" });
  t.check(await box.read(CARD), PENDING);
});

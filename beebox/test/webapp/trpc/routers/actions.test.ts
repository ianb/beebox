// # tRPC actions: answer / dismiss
//
// `actions.answer` and `actions.dismiss` are the procedures the frontend uses to
// resolve a question (the raw `/api/actions/answer` route was removed). Each
// delegates to the shared command, then emits a bus event so live surfaces
// refresh. A command failure surfaces as a `BAD_REQUEST` TRPCError.

import { test } from "tap";
import "agent-doctest/tap";
import { actionsRouter } from "../../../../src/webapp/trpc/routers/actions.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { EventBus } from "../../../../src/core/event-bus/core.js";
import { TRPCError } from "@trpc/server";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

// Minimal tRPC context — the actions procedures read only boxRoot + eventBus.
// The eventBus stub records what was emitted so we can assert on it.
function contextFor(box: { root: string }) {
  const events: { event: string; data: unknown }[] = [];
  const eventBus: EventBus = {
    emit: (event, data) => { events.push({ event, data }); return 0; },
    emitTransient: () => {},
    readSince: () => [],
    readRecent: () => [],
    subscribe: () => ({ unsubscribe: () => {} }),
    prune: () => 0,
    close: () => {},
  };
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", eventBus });
  return { caller: actionsRouter.createCaller(ctx), events };
}

async function attempt(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return e instanceof TRPCError ? `THREW:${e.code}:${e.message}` : `THREW:${String(e)}`;
  }
}

const SELECT = `---
prompt: Pick one
input:
  type: select
  options:
    - {id: red, label: Red}
    - {id: blue, label: Blue}
directive: Use the picked color
---
`;

// ## answer resolves the card and emits `question-answered`
void test("answer resolves the card and emits `question-answered`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L56
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Color.question.card", SELECT);
  const { caller, events } = contextFor(box);

  // doctest:L60
  const res = await caller.answer({ questionPath: "_bookkeeping/questions/Color.question.card", answer: "Red" });
  t.check(res.success, true);

  // doctest:L64
  t.check(res.message, "Question answered");

  // doctest:L67
  await t.checkText((await box.read("_bookkeeping/questions/Color.question.card")).includes("selected: red"), "true");

  // doctest:L70
  t.check(events.map((e) => e.event).join(","), "question-answered");
});

// ## answer surfaces a command failure as BAD_REQUEST
//
// Answering a card that doesn't exist fails in the command; the procedure turns it
// into a `BAD_REQUEST`:
void test("Answering a card that doesn't exist fails in the command; the procedure turns...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L84
  const box = await makeTmpBox({ git: true });
  const { caller } = contextFor(box);

  // doctest:L87
  const out = await attempt(() => caller.answer({ questionPath: "_bookkeeping/questions/Nope.question.card", answer: "Red" }));
  await t.checkText(String(out).startsWith("THREW:BAD_REQUEST:"), "true");
});

// ## dismiss flips the card and emits `question-dismissed`
void test("dismiss flips the card and emits `question-dismissed`", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L99
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Color.question.card", SELECT);
  const { caller, events } = contextFor(box);

  // doctest:L103
  const res = await caller.dismiss({ questionPath: "_bookkeeping/questions/Color.question.card" });
  t.check(res.success, true);

  // doctest:L107
  t.check(res.message, "Question dismissed");

  // doctest:L110
  await t.checkText((await box.read("_bookkeeping/questions/Color.question.card")).includes("dismissed-at:"), "true");

  // doctest:L113
  t.check(events.map((e) => e.event).join(","), "question-dismissed");
});

// ## dismiss rejects a non-pending question as BAD_REQUEST
void test("dismiss rejects a non-pending question as BAD_REQUEST", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L124
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/Color.question.card",
    // A coherent answered card carries answer + answered-at (schema-required).
    SELECT.replace(
      "---\n",
      "---\nanswered-at: 2026-01-01T00:00:00-07:00\nanswer:\n  text: Red\n  selected: red\n",
    ),
  );
  const { caller } = contextFor(box);

  // doctest:L135
  const out = await attempt(() => caller.dismiss({ questionPath: "_bookkeeping/questions/Color.question.card" }));
  await t.checkText(String(out).startsWith("THREW:BAD_REQUEST:"), "true");
});

// ## Absolute paths are rejected at the web boundary
//
// The tRPC input is box-relative only: an absolute `questionPath` is refused at
// input validation (a `BAD_REQUEST`), before the command runs — even one that
// would resolve inside the box. The CLI still accepts inside-the-box absolutes;
// the web boundary does not.
void test("The tRPC input is box-relative only:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L152
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/Color.question.card", SELECT);
  const { caller } = contextFor(box);

  // doctest:L156
  const absPath = `${box.root}/_bookkeeping/questions/Color.question.card`;

  // doctest:L158
  const ans = await attempt(() => caller.answer({ questionPath: absPath, answer: "Red" }));
  await t.checkText(String(ans).startsWith("THREW:BAD_REQUEST:"), "true");

  // doctest:L162
  const dis = await attempt(() => caller.dismiss({ questionPath: absPath }));
  await t.checkText(String(dis).startsWith("THREW:BAD_REQUEST:"), "true");

  // doctest:L166
  await t.checkText((await box.read("_bookkeeping/questions/Color.question.card")).includes("-at:"), "false");
});

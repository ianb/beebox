// # tRPC actions: answer / dismiss
//
// `actions.answer` and `actions.dismiss` are the procedures the frontend uses to
// resolve a question (the raw `/api/actions/answer` route was removed). Each
// delegates to the shared command, then emits a bus event so live surfaces
// refresh. A command failure surfaces as a `BAD_REQUEST` TRPCError.

import { test } from "tap";
import { isoDate } from "agent-doctest/check";
import "agent-doctest/tap";
import { actionsRouter } from "../../../../src/webapp/trpc/routers/actions.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { EventBus } from "../../../../src/core/event-bus/core.js";
import { TRPCError } from "@trpc/server";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
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
  t.check(res, { success: true, message: "Question answered", path: "_bookkeeping/questions/Color.question.card" });

  // doctest:L67
  t.checkText(await box.read("_bookkeeping/questions/Color.question.card"), `---
type: question
prompt: Pick one
input:
  type: select
  options:
    - id: red
      label: Red
    - id: blue
      label: Blue
directive: Use the picked color
answer:
  text: Red
  selected: red
answered-at: «date»
answered-via: web
---`);

  // doctest:L70
  t.check(events, [
    { event: "question-answered", data: { path: "_bookkeeping/questions/Color.question.card", answer: "Red", selectedId: undefined, timestamp: isoDate() } },
  ]);
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
  t.check(out, "THREW:BAD_REQUEST:Could not load card: _bookkeeping/questions/Nope.question.card");
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
  t.check(res, { success: true, message: "Question dismissed", path: "_bookkeeping/questions/Color.question.card" });

  // doctest:L110
  t.checkText(await box.read("_bookkeeping/questions/Color.question.card"), `---
type: question
prompt: Pick one
input:
  type: select
  options:
    - id: red
      label: Red
    - id: blue
      label: Blue
directive: Use the picked color
dismissed-at: «date»
---`);

  // doctest:L113
  t.check(events, [{ event: "question-dismissed", data: { path: "_bookkeeping/questions/Color.question.card", timestamp: isoDate() } }]);
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
  t.check(out, "THREW:BAD_REQUEST:Question is answered, not pending; only a pending question can be dismissed");
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
  t.check(ans, `THREW:BAD_REQUEST:[
  {
    "code": "custom",
    "path": [
      "questionPath"
    ],
    "message": "questionPath must be box-relative, not absolute"
  }
]`);

  // doctest:L162
  const dis = await attempt(() => caller.dismiss({ questionPath: absPath }));
  t.check(dis, `THREW:BAD_REQUEST:[
  {
    "code": "custom",
    "path": [
      "questionPath"
    ],
    "message": "questionPath must be box-relative, not absolute"
  }
]`);

  // doctest:L166
  t.check(await box.read("_bookkeeping/questions/Color.question.card"), SELECT);
});

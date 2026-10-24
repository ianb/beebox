// # status.navStatus
//
// `status.navStatus` is the query the app nav mounts on **every** page, so it
// returns only the two badge counts the nav renders and computes only those. It
// does not touch `getSystemState` — no `git status`, no `git log`, no inbox scan,
// no full card load of every question — which is what makes it cheap enough to
// sit on the critical path of every page load. `status.status` (the dashboard's
// payload) keeps its fuller shape.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { TmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { statusRouter } from "../../../../src/webapp/trpc/routers/status.js";
import { runTodoQuery } from "../../../../src/core/todo/query.js";
import { ROOT_QUESTION_PATH } from "../../../../src/core/box/root-question-path.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

/** Every todo in the box, whatever its status or `assigned` — the collection runner, box-wide. */
async function collectTodos(boxRoot: string) {
  const result = await runTodoQuery(boxRoot, {
    query: { here: "", params: { status: ["open", "done", "dropped", "parked"], scope: "all" } },
    since: null,
  });
  return { todos: result.groups.flatMap((g) => g.rows).flatMap((r) => r.items), issues: result.issues };
}

function caller(box: TmpBox) {
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", actor: "none" });
  return statusRouter.createCaller(ctx);
}

// A question card; `lifecycle` is its lifecycle fields (none: pending).
function question(lifecycle: string) {
  return `---
${lifecycle}prompt: Pick one
input:
  type: text
directive: Use the answer
---
`;
}

// ## An empty box counts zero of each
//
// The questions directory doesn't exist yet in a fresh box — a missing directory
// is zero pending questions, not an error.
void test("The questions directory doesn't exist yet in a fresh box — a missing director...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  t.check(await caller(box).navStatus(), {
    counts: {
      pendingQuestions: 0,
      onPlateTodos: 0,
      escalatedTodos: 0,
      laterTodos: 0,
    },
  });
});

// ## Only `pending` questions count, at any depth
//
// Answered and dismissed questions are resolved; they don't belong on the badge.
// Questions filed in a subdirectory still count — the nav badge is box-wide.
void test("Answered and dismissed questions are resolved; they don't belong on the badge.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/questions/One.question.card", question(""));
  await box.write("_bookkeeping/questions/Two.question.card", question("answer:\n  text: Blue\nanswered-at: 2026-01-02T00:00:00Z\n"));
  await box.write("_bookkeeping/questions/Three.question.card", question("dismissed-at: 2026-01-02T00:00:00Z\n"));
  await box.write("_bookkeeping/questions/inbox-review/Four.question.card", question(""));

  const counts = (await caller(box).navStatus()).counts;
  t.check(counts.pendingQuestions, 2);

  // A question card with no lifecycle timestamp counts as pending even if the
  // rest of its frontmatter is invalid — a broken card the boxholder has to fix is exactly the
  // one that shouldn't quietly disappear from the badge. `status.status` reports
  // the same number (it shares this count rather than deriving its own), so the
  // nav and the dashboard can't disagree.

  await box.write("_bookkeeping/questions/Broken.question.card", "---\ninput: not-a-mapping\n---\n");

  const navCount = (await caller(box).navStatus()).counts.pendingQuestions;
  const dashboardCount = (await caller(box).status()).counts.pendingQuestions;
  t.check(`${navCount} == ${dashboardCount}`, "3 == 3");

  // ## The root question is not counted while the chat is empty
  //
  // The empty chat shows the root question as its opening line, so the nav
  // badge and the Box page leave it out while it is pending and the box has no
  // chat. The Questions page still lists it. Once the person has a chat (a
  // husk exists) and the question is still pending, it counts again.

  await box.write(ROOT_QUESTION_PATH, question(""));
  t.check((await caller(box).navStatus()).counts.pendingQuestions, 3);

  await box.write("_content/chat/web/2026-10-22_aaaaaaaa.chat.card", "---\nsession: aaaaaaaa-1111-4111-8111-111111111111\n---\n");
  t.check((await caller(box).navStatus()).counts.pendingQuestions, 4);

  // Answered, it drops out again.
  await box.write(ROOT_QUESTION_PATH, question("answer:\n  text: Bees\nanswered-at: 2026-01-02T00:00:00Z\n"));
  t.check((await caller(box).navStatus()).counts.pendingQuestions, 3);

  // ## Todos on the plate are counted; done and future ones are not
  //
  // `onPlateTodos` is `escalated` (past due) plus `on-plate` (started, or undated) —
  // the same derivation `bbx todos` uses, reached through the shared collector. A
  // `done` todo and one that hasn't started yet are both off the plate; the
  // not-yet-started one is counted as `laterTodos`, the todo page's "later".

  await box.write(
    "_content/notes/Plans.doc.card",
    `---
title: Plans
todos:
  - text: Undated, so on the plate
  - text: Already finished
    status: done
  - text: Starts next century
    start: "2199-01-01"
---
Body.
`,
  );

  const withTodos = (await caller(box).navStatus()).counts;
  t.check(withTodos, {
    pendingQuestions: 3,
    onPlateTodos: 1,
    escalatedTodos: 0,
    laterTodos: 1,
  });

  // ## The count agrees with the full collector
  //
  // The badge count is a fast path (parallel reads, and cards whose text can't
  // mention a todo are skipped without parsing). It must still agree, card for
  // card, with what a box-wide todo query reports — including a `{% todo %}` captured in a
  // card body rather than frontmatter.

  await box.write(
    "_content/notes/Body.doc.card",
    `---
title: Body capture
---
{% todo %}Written in the body{% /todo %}
`,
  );

  const collected = await collectTodos(box.root);
  const fromCollector = collected.todos.filter(
    (todo) => todo.plateState === "escalated" || todo.plateState === "on-plate",
  ).length;
  const fromBadge = (await caller(box).navStatus()).counts.onPlateTodos;

  t.check(`${fromCollector} == ${fromBadge}`, "2 == 2");
});

// ## `escalatedTodos` counts what's past due, agent-assigned excluded
//
// The nav badge's dot: an escalated boxholder todo bumps it, an escalated agent
// follow-up does not — same `isBoxholderTodo` ownership rule as the badge
// number itself.
void test("The nav badge's dot:", async (t) => {
  t.teardown(async () => {
    try {
      await escBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const escBox = await makeTmpBox({ git: true });
  await escBox.write(
    "_content/notes/Overdue.doc.card",
    `---
title: Overdue
---
{% todo due="2026-07-01" %}Boxholder, overdue{% /todo %}

{% todo assigned="agent" by="agent" created="2026-07-01" due="2026-07-01" %}Agent, overdue{% /todo %}
`,
  );

  const escCounts = (await caller(escBox).navStatus()).counts;
  t.check([escCounts.onPlateTodos, escCounts.escalatedTodos], [
    1,
    1,
  ]);
});

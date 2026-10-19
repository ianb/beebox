// # Setting one todo's status (`core/todo/set-status.ts`)
//
// `setTodoStatus` edits exactly the bytes that change: a body `{% todo %}`
// tag's opening tag, or one frontmatter `todos:` entry's `status` field.
// Everything else in the card is unchanged.

import { test } from "tap";
import "agent-doctest/tap";
import { setTodoAttribute, setTodoStatus } from "../../../src/core/todo/set-status.js";
import { extractCardTodos } from "../../../src/core/todo/extract/core.js";
import { buildLoadContext } from "../../../src/core/load-context.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const box = await makeTmpBox();
const ctx = await buildLoadContext(box.root);
const CARD = "_content/Kitchen.doc.card";

const BASE_ITEM = {
  path: CARD,
  locator: { kind: "body", line: 5 },
  id: undefined,
  status: "open",
  assigned: undefined,
  by: undefined,
  created: undefined,
  due: undefined,
  start: undefined,
  recheck: undefined,
  seeAlso: [],
  sectionPath: [],
  parent: null,
  annotation: "",
  refs: [],
} as const;

// Four-line frontmatter block (`title` plus `contains`), so
// body line 1 is file line 5.
function doc(body: string): string {
  return `---\ntitle: Kitchen\ncontains: Notes on the kitchen remodel.\n---\n${body}`;
}

// ## Inline tag: `done` inserts `status="done"` right after `todo`
void test("Inline tag: `done` inserts `status=\"done\"` right after `todo`", async (t) => {
  // doctest:L27
  await t.checkText(setTodoStatus(doc("{% todo %}Buy milk{% /todo %}\n"), { locator: { kind: "body", line: 5 }, status: "done" }), `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo status="done" %}Buy milk{% /todo %}`);
});

// ## Block tag: the same edit, on its opening line only
void test("Block tag: the same edit, on its opening line only", async (t) => {
  // doctest:L39
  await t.checkText(
    setTodoStatus(doc(["{% todo %}", "Buy milk", "{% /todo %}", ""].join("\n")), {
      locator: { kind: "body", line: 5 },
      status: "done",
    }),
    `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo status="done" %}
Buy milk
{% /todo %}`,
  );
});

// ## Two todos on one line: `nth: 2` edits the second, the first is untouched
void test("Two todos on one line: `nth: 2` edits the second, the first is untouched", async (t) => {
  // doctest:L56
  await t.checkText(
    setTodoStatus(doc("{% todo %}One{% /todo %} {% todo %}Two{% /todo %}\n"), {
      locator: { kind: "body", line: 5, nth: 2 },
      status: "done",
    }),
    `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo %}One{% /todo %} {% todo status="done" %}Two{% /todo %}`,
  );
});

// ## Other attributes are kept, in the order they were written
//
// `status` is always inserted right after `todo`, whatever else follows.
void test("status is always inserted right after todo, whatever else follows.", async (t) => {
  // doctest:L73
  await t.checkText(
    setTodoStatus(doc('{% todo assigned="agent" due="2026-08-01" %}Something{% /todo %}\n'), {
      locator: { kind: "body", line: 5 },
      status: "done",
    }),
    `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo status="done" assigned="agent" due="2026-08-01" %}Something{% /todo %}`,
  );
});

// ## `open` removes the `status` attribute entirely (absence means open)
void test("`open` removes the `status` attribute entirely (absence means open)", async (t) => {
  // doctest:L88
  await t.checkText(
    setTodoStatus(doc('{% todo status="done" %}Buy milk{% /todo %}\n'), {
      locator: { kind: "body", line: 5 },
      status: "open",
    }),
    `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo %}Buy milk{% /todo %}`,
  );
});

// `setTodoStatus` itself will overwrite any existing status — a `parked` todo
// included. The caller (a later track's `todos.setStatus` mutation) is what
// enforces `expectedStatus`, not this function.
void test("setTodoStatus itself will overwrite any existing status — a parked todo inclu...", async (t) => {
  // doctest:L105
  await t.checkText(
    setTodoStatus(doc('{% todo status="parked" %}Wait{% /todo %}\n'), {
      locator: { kind: "body", line: 5 },
      status: "done",
    }),
    `---
title: Kitchen
contains: Notes on the kitchen remodel.
---
{% todo status="done" %}Wait{% /todo %}`,
  );
});

// ## Frontmatter entry: set and removal, body left byte-identical
void test("Frontmatter entry: set and removal, body left byte-identical", async (t) => {
  // doctest:L120
  const fm = [
    "---",
    "title: Kitchen",
    "todos:",
    '  - text: "Renew the permit"',
    "    status: parked",
    "---",
    "Some body prose, unrelated to the todo.",
    "",
  ].join("\n");

  // doctest:L131
  const fmDone = setTodoStatus(fm, { locator: { kind: "frontmatter", index: 0 }, status: "done" });
  t.check(
    fmDone,
    '---\ntitle: Kitchen\ntodos:\n  - text: "Renew the permit"\n    status: done\n---\nSome body prose, unrelated to the todo.\n',
  );

  // doctest:L147
  await t.checkText(setTodoStatus(fmDone, { locator: { kind: "frontmatter", index: 0 }, status: "open" }), `---
title: Kitchen
todos:
  - text: "Renew the permit"
---
Some body prose, unrelated to the todo.`);
});

// ## An unresolved locator throws, rather than silently editing nothing
void test("An unresolved locator throws, rather than silently editing nothing", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L160
  await t.checkThrows(async () => (setTodoStatus(doc("plain text, no todo here\n"), { locator: { kind: "body", line: 5 }, status: "done" })), "TodoLocatorNotFoundError");

  // doctest:L163
  await t.checkThrows(async () => (setTodoStatus(doc("{% todo %}Only one{% /todo %}\n"), { locator: { kind: "body", line: 5, nth: 2 }, status: "done" })), "TodoLocatorNotFoundError");

  // doctest:L166
  await t.checkThrows(async () => (setTodoStatus("title: Kitchen\n", { locator: { kind: "frontmatter", index: 0 }, status: "done" })), "TodoLocatorNotFoundError");

  // ## Round-trip: the result reports the new status at the same locator
  //
  // `setTodoStatus` numbers the tag with the same `assignLocators` pass the
  // collector uses, so a locator read from `extractCardTodos` before the write
  // still finds the same todo after it.

  // doctest:L177
  const before = extractCardTodos({ relPath: CARD, content: doc("{% todo %}Buy milk{% /todo %}\n"), ctx }).items[0]!;
  t.check(before, { ...BASE_ITEM, text: "Buy milk" });

  // doctest:L181
  const updated = setTodoStatus(doc("{% todo %}Buy milk{% /todo %}\n"), { locator: before.locator, status: "done" });
  t.check(extractCardTodos({ relPath: CARD, content: updated, ctx }).items, [{ ...BASE_ITEM, text: "Buy milk", status: "done" }]);

  // ## `setTodoAttribute`: the same surgery for `recheck`
  //
  // `setTodoStatus` is `setTodoAttribute` on `status`. The todo-review's verify
  // step uses it on `recheck` (`docs/plans/todos-ui.md`, Track 7): an existing
  // value is replaced in place, a missing one is inserted after `todo`, and the
  // todo's words and its annotation stay as written. Extraction reads the new
  // value back at the same locator.

  // doctest:L195
  const dated = doc('Order lumber {% todo due="2026-07-01" recheck="2026-08-15" %}for the deck{% /todo %} — waiting on a quote\n');
  const retired = setTodoAttribute(dated, { locator: { kind: "body", line: 5 }, name: "recheck", value: "never" });
  t.check(
    retired,
    doc('Order lumber {% todo due="2026-07-01" recheck="never" %}for the deck{% /todo %} — waiting on a quote\n'),
  );

  // doctest:L200
  t.check(
    setTodoAttribute(doc("{% todo %}Buy milk{% /todo %}\n"), { locator: { kind: "body", line: 5 }, name: "recheck", value: "2026-10-01" }),
    doc('{% todo recheck="2026-10-01" %}Buy milk{% /todo %}\n'),
  );

  // doctest:L203
  t.check(extractCardTodos({ relPath: CARD, content: retired, ctx }).items, [
    { ...BASE_ITEM, text: "for the deck", due: "2026-07-01", recheck: "never", annotation: "waiting on a quote" },
  ]);

  // A frontmatter entry gets the key; `null` removes it.

  // doctest:L210
  const fm = "---\ntitle: Kitchen\ncontains: Notes on the kitchen remodel.\ntodos:\n  - text: Renew permit\n    recheck: 2026-08-01\n---\nBody.\n";
  await t.checkText(setTodoAttribute(fm, { locator: { kind: "frontmatter", index: 0 }, name: "recheck", value: "never" }), `---
title: Kitchen
contains: Notes on the kitchen remodel.
todos:
  - text: Renew permit
    recheck: never
---
Body.`);

  // doctest:L222
  t.check(
    setTodoAttribute(fm, { locator: { kind: "frontmatter", index: 0 }, name: "recheck", value: null }),
    "---\ntitle: Kitchen\ncontains: Notes on the kitchen remodel.\ntodos:\n  - text: Renew permit\n---\nBody.\n",
  );
});

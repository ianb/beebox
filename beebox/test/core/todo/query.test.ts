// # Scanning a box for todos (`core/todo/query.ts`)
//
// Filesystem-tier doctests for `docs/implemented-plans/todo-annotation.md`
// Track 3, carried forward onto the collection runner
// (`docs/plans/todo-collection.md`, Track 4). A box-wide query globs every card,
// parses each body once against the shared Markdoc vocabulary, and merges both
// capture forms (`{% todo %}` tags, frontmatter `todos:` entries) into one
// deterministically ordered list — reporting parse/validate/load failures and
// duplicate `id`s as visible issues rather than silently dropping a card's
// todos.
//
// `collection-run.doctest.md` covers the scope, grouping, and reduction rules;
// this file covers what one card contributes and what a card that cannot
// contribute reports.

import { test } from "tap";
import "agent-doctest/tap";
import { runTodoQuery } from "../../../src/core/todo/query.js";
import { formatTodoLocation } from "../../../src/core/todo/collect-types.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** Every todo in the glob, whatever its status or assignee, plus the issues beside them. */
async function collectTodos(boxRoot: string, options?: { glob: string }) {
  const result = await runTodoQuery(boxRoot, {
    query: {
      here: "",
      ...(options === undefined ? {} : { glob: options.glob }),
      params: { status: ["open", "done", "dropped", "parked"], scope: "all" },
    },
    since: null,
  });
  return {
    todos: result.groups.flatMap((g) => g.rows).flatMap((r) => r.items),
    issues: result.issues,
  };
}

const DOC_FM = "title: Kitchen\ncontains: Notes on the kitchen remodel.\n";

function doc(frontmatterExtra: string, body: string): string {
  return `---\n${DOC_FM}${frontmatterExtra}---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

const box = await makeTmpBox();
// America/Chicago is UTC-5 in July (CDT) — the frozen time above is
// 2026-07-28T07:00 local, still July 28th locally, which is what the
// plate-state doctests below assume.
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));

// ## Both capture forms are collected
//
// A body `{% todo %}` tag and a frontmatter `todos:` entry on the same card
// both show up, each with its own locator kind.
void test("A body {% todo %} tag and a frontmatter todos: entry on the same card both sh...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L58
  await box.write(
    "store/a.doc.card",
    doc(
      'todos:\n  - text: "Renew parking permit"\n    due: "2026-08-15"\n',
      'Body text.\n\n{% todo id="vet-refill" assigned="Dana" %}Call the vet{% /todo %}\n'
    )
  );
  const result1 = await collectTodos(box.root);
  await t.checkText(JSON.stringify(result1.todos.map((todo) => ({ locator: todo.locator, id: todo.id, text: todo.text })), null, 2), `[
  {
    "locator": {
      "kind": "body",
      "line": 10
    },
    "id": "vet-refill",
    "text": "Call the vet"
  },
  {
    "locator": {
      "kind": "frontmatter",
      "index": 0
    },
    "text": "Renew parking permit"
  }
]`);

  // `locator.line` is the true FILE line, not the body-relative one: the
  // frontmatter block's line count (`splitCardContent`'s `lineOffset`) is added
  // to the tag's body-relative line before reporting it.

  // doctest:L92
  await t.checkText(result1.issues.length, "0");

  // ## Nested `{% see-also %}` is pulled out, not left in the main text

  // doctest:L99
  await box.write(
    "store/b.doc.card",
    doc(
      "",
      '{% todo id="with-see-also" %}Ping Marcus {% see-also ref="store/a.doc.card" %}he offered to help{% /see-also %} about the quote.{% /todo %}\n'
    )
  );
  const result2 = await collectTodos(box.root, { glob: "store/b.doc.card" });
  await t.checkText(JSON.stringify(result2.todos[0]?.seeAlso), "[{\"ref\":\"store/a.doc.card\",\"note\":\"he offered to help\"}]");

  // doctest:L110
  t.check(result2.todos[0]?.text, "Ping Marcus about the quote.");

  // ## Plate-state derivation around the frozen time (2026-07-28, box-local)
  //
  // `escalated` (past `due`), `on-plate` (undated, or `start` already reached),
  // `quiet` (before `start`), and `parked` are each derived from the shared
  // `todo-model.ts` truth table using the box's configured timezone.

  // doctest:L121
  await box.write(
    "store/plate.doc.card",
    doc(
      "",
      [
        '{% todo id="p-escalated" due="2026-07-27" %}Overdue{% /todo %}',
        "",
        '{% todo id="p-on-plate" %}Undated, on the plate now{% /todo %}',
        "",
        '{% todo id="p-quiet" due="2026-08-01" start="2026-07-30" %}Not yet{% /todo %}',
        "",
        '{% todo id="p-parked" status="parked" %}Parked{% /todo %}',
        "",
      ].join("\n")
    )
  );
  const plateResult = await collectTodos(box.root, { glob: "store/plate.doc.card" });
  t.check(Object.fromEntries(plateResult.todos.map((todo) => [todo.id, todo.plateState])), {
    "p-escalated": "escalated",
    "p-on-plate": "on-plate",
    "p-quiet": "quiet",
    "p-parked": "parked",
  });

  // ## A `{% todo %}` with an invalid `status` is a visible-invalid result, not a silent drop

  // doctest:L155
  await box.write(
    "store/bad-status.doc.card",
    doc("", '{% todo status="Done" %}Bad status{% /todo %}\n')
  );
  const badStatusResult = await collectTodos(box.root, { glob: "store/bad-status.doc.card" });
  await t.checkText(badStatusResult.todos.length, "0");

  // doctest:L163
  t.check(badStatusResult.issues.map((i) => i.kind), [
    "validate",
  ]);

  // doctest:L166
  t.check(badStatusResult.issues[0]?.message, "line 1: Attribute 'status' must match one of [\"open\",\"done\",\"dropped\",\"parked\"]. Got 'Done' instead.");

  // ## A multi-line `{% todo %}` block with an invalid `status` is also visible-invalid, not silently coerced to `open`
  //
  // Regression coverage for the `collectTagSpans`/`tagNameFor` line-attribution
  // bug: a **multi-line block** `{% todo %}` (opening tag, body, closing tag on
  // separate lines) used to fall through the "which tag does this validate error
  // belong to" match (it compared against `lines[1]`, correct only for a one-line
  // span) and get attributed to `(body)` instead of `todo` — so
  // `extract-body.ts`'s `todoErrors` filter never caught it, and the invalid
  // `status` was silently coerced to `"open"` instead of becoming a visible-invalid
  // result.

  // doctest:L182
  await box.write(
    "store/bad-status-multiline.doc.card",
    doc("", '{% todo status="Done" %}\nBad status, multi-line\n{% /todo %}\n')
  );
  const badStatusMultiline = await collectTodos(box.root, { glob: "store/bad-status-multiline.doc.card" });
  await t.checkText(badStatusMultiline.todos.length, "0");

  // doctest:L190
  t.check(badStatusMultiline.issues.map((i) => i.kind), [
    "validate",
  ]);

  // ## A card whose type has no registered schema is a visible `unknown-type` issue, not a silent skip

  // doctest:L197
  await box.write(
    "store/unknown-type.memmo.card",
    doc("", "{% todo %}Never collected — unregistered type{% /todo %}\n")
  );
  const unknownTypeResult = await collectTodos(box.root, { glob: "store/unknown-type.memmo.card" });
  await t.checkText(unknownTypeResult.todos.length, "0");

  // doctest:L205
  t.check(unknownTypeResult.issues[0]?.kind, "unknown-type");

  // doctest:L208
  t.check(unknownTypeResult.issues[0]?.message, "no registered schema for card type \"memmo\"");

  // ## Unparseable frontmatter is a visible `load` issue

  // doctest:L215
  await box.write(
    "store/bad-frontmatter.doc.card",
    "---\ntitle: [unclosed\n---\n{% todo %}Never collected{% /todo %}\n"
  );
  const badLoadResult = await collectTodos(box.root, { glob: "store/bad-frontmatter.doc.card" });
  await t.checkText(badLoadResult.todos.length, "0");

  // doctest:L223
  t.check(badLoadResult.issues[0]?.kind, "load");

  // ## Duplicate `id` across cards is reported, but both todos still come back

  // doctest:L230
  await box.write("store/dup1.doc.card", doc("", '{% todo id="shared" %}First{% /todo %}\n'));
  await box.write("store/dup2.doc.card", doc("", '{% todo id="shared" %}Second{% /todo %}\n'));
  const dupResult = await collectTodos(box.root, { glob: "store/dup{1,2}.doc.card" });
  t.check(dupResult.todos.map((todo) => todo.text).join(", "), "First, Second");

  // doctest:L236
  await t.checkText(dupResult.issues.length, "1");

  // doctest:L239
  t.check(dupResult.issues[0]?.kind, "duplicate-id");

  // doctest:L242
  t.check(dupResult.issues[0]?.message, "duplicate todo id \"shared\" used at: store/dup1.doc.card:5, store/dup2.doc.card:5");

  // ## `--glob` scopes which cards are scanned

  // doctest:L249
  await box.write("other/c.doc.card", doc("", '{% todo id="outside-scope" %}Not scoped in{% /todo %}\n'));
  const scoped = await collectTodos(box.root, { glob: "store/dup1.doc.card" });
  t.check(scoped.todos.map((todo) => todo.id).join(", "), "shared");

  // ## A directory-shaped glob scopes to cards; non-card files are not "unreadable cards"
  //
  // The box-wide plate ships `glob: "**"` and project plates use bare directory
  // globs (`store/projects/foo/**`) — patterns that match every file under their
  // scope, not just cards. Non-card files (`_config/box.json`, a stray `.md`) are
  // not todo candidates and must not surface as read failures: before
  // `listTodoCardPaths` scoped every pattern to `.card` files centrally, a
  // box-wide plate rendered every non-card file in the box as a
  // "card couldn't be read" error.

  // doctest:L266
  await box.write("store/notes.md", "Not a card at all.\n");
  const wideOpen = await collectTodos(box.root, { glob: "**" });
  t.check(wideOpen.issues.filter((i) => i.path === "store/notes.md" || i.path === "_config/box.json"), []);

  // doctest:L271
  await t.checkText(wideOpen.todos.length > 0, "true");

  // ## A malformed box timezone degrades instead of crashing the whole collector
  //
  // `_config/box.json`'s `timezone` is hand-editable; a typo'd IANA zone (e.g.
  // `"America/Chciago"`) used to make `Intl.DateTimeFormat` throw a bare
  // `RangeError` the moment plate-state derivation ran for ANY todo — taking
  // down every todo query (and everything built on it: `bbx query todos`, the
  // list, the badge, the review sweep) rather than just that one box's timezone
  // display. `loadBoxTimezone` now validates and falls back to the host
  // timezone with a warning instead of throwing.

  // doctest:L286
  const badTzBox = await makeTmpBox();
  await badTzBox.write("_config/box.json", JSON.stringify({ timezone: "America/Chciago" }));
  await badTzBox.write(
    "store/x.doc.card",
    doc("", '{% todo id="survives" %}Should still collect{% /todo %}\n')
  );
  const badTzResult = await collectTodos(badTzBox.root);
  t.check(badTzResult.todos.map((todo) => todo.id).join(", "), "survives");

  // doctest:L296
  await badTzBox.cleanup();

  // ## Deterministic ordering: path, then locator
  //
  // Re-running the full-box collection returns todos in the same path-then-
  // locator order every time (body locators sort before frontmatter locators on
  // the same card).

  // doctest:L306
  const full = await collectTodos(box.root);
  await t.checkText(full.todos.map((todo) => `${todo.path}#${formatTodoLocation(todo)}`).join("\n"), `other/c.doc.card#other/c.doc.card:5
store/a.doc.card#store/a.doc.card:10
store/a.doc.card#store/a.doc.card#todos[0]
store/b.doc.card#store/b.doc.card:5
store/dup1.doc.card#store/dup1.doc.card:5
store/dup2.doc.card#store/dup2.doc.card:5
store/plate.doc.card#store/plate.doc.card:5
store/plate.doc.card#store/plate.doc.card:7
store/plate.doc.card#store/plate.doc.card:9
store/plate.doc.card#store/plate.doc.card:11`);
});

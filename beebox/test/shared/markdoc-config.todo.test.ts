// # Markdoc `{% todo %}` / `{% see-also %}` — parse/validate/transform
//
// `todo` is the universal capture-in-place annotation
// (`docs/implemented-plans/todo-annotation.md`); `see-also` nests inside it and points at
// supporting context. Both delegate attribute validation to
// `todo-model.ts`'s `validateTodoAttributes` — this doctest exercises the
// Markdoc-level wiring (schema `matches`, `validate()`, and the transform's
// tag names / `ref` → `sourceRef` rename), not the date-math rules themselves
// (covered by `todo-model.doctest.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, validate, renderers } = Markdoc;

// "valid" when the body has no validation errors, else the error ids joined.
function check(src: string): string {
  const errors = validate(parse(src), markdocConfig);
  if (errors.length === 0) return "valid";
  return errors.map((e) => e.error.id).join(", ");
}

function render(src: string): string {
  return renderers.html(transform(parse(src), markdocConfig));
}

// ## A valid todo, block form
void test("A valid todo, block form", async (t) => {
  t.check(render('{% todo id="vet-refill" assigned="Dana" due="2026-08-01" %}\n\nCall the vet about the prescription refill\n\n{% /todo %}'), "<article><TodoBlock id=\"vet-refill\" assigned=\"Dana\" due=\"2026-08-01\"><p>Call the vet about the prescription refill</p></TodoBlock></article>");
});

// ## A valid todo, inline form
void test("A valid todo, inline form", async (t) => {
  t.check(render("Remember to {% todo %}call the vet{% /todo %} today."), "<article><p>Remember to <TodoInline>call the vet</TodoInline> today.</p></article>");
});

// ## Bare `{% todo %}` (no attributes) is a valid open todo
void test("Bare `{% todo %}` (no attributes) is a valid open todo", async (t) => {
  t.check(check("{% todo %}\n\nJust a plain todo\n\n{% /todo %}"), "valid");
});

// ## `status` enum rejects a typo
//
// `matches` is Markdoc's own built-in attribute-enum check (`attribute-value-invalid`) — the schema hands it the `TODO_STATUSES` list from `todo-model.ts` rather than restating the enum.
void test("matches is Markdoc's own built-in attribute-enum check (attribute-value-inval...", async (t) => {
  t.check(check('{% todo status="Done" %}\n\ntext\n\n{% /todo %}'), "attribute-value-invalid");
});

// ## Valid status values all pass
void test("Valid status values all pass", async (t) => {
  t.check(check('{% todo status="open" %}\n\ntext\n\n{% /todo %}'), "valid");

  t.check(check('{% todo status="parked" %}\n\ntext\n\n{% /todo %}'), "valid");
});

// ## Relative `start` without `due` is a validate() error
void test("Relative `start` without `due` is a validate() error", async (t) => {
  t.check(check('{% todo start="-3d" %}\n\ntext\n\n{% /todo %}'), "todo-relative-start-requires-due");
});

// ## `start` after `due` (both absolute) is a validate() error
void test("`start` after `due` (both absolute) is a validate() error", async (t) => {
  t.check(check('{% todo due="2026-08-01" start="2026-08-05" %}\n\ntext\n\n{% /todo %}'), "todo-start-after-due");
});

// ## `by="agent"` without `created` is a validate() error
void test("`by=\"agent\"` without `created` is a validate() error", async (t) => {
  t.check(check('{% todo by="agent" %}\n\ntext\n\n{% /todo %}'), "todo-agent-requires-created");

  t.check(check('{% todo by="agent" created="2026-07-28" %}\n\ntext\n\n{% /todo %}'), "valid");
});

// ## `recheck` is a declared attribute: a date or `never`, else a validate() error
void test("`recheck` is a declared attribute: a date or `never`, else a validate() error", async (t) => {
  t.check(check('Order lumber {% todo due="2026-07-01" recheck="2026-10-15" %}soon{% /todo %}'), "valid");

  t.check(check('{% todo recheck="never" %}old idea{% /todo %}'), "valid");

  t.check(check('{% todo recheck="next week" %}text{% /todo %}'), "todo-invalid-recheck");
});

// ## `assigned` names a person, but not the boxholder by a placeholder
//
// `assigned` is absent for the boxholder's own todos, `"agent"` for the box
// agent's, and otherwise names a person (whether as a plain name or a ref is not
// settled). A journey walk found an agent writing `assigned="user"` for the
// boxholder, which the UI then showed as a badge reading "user". Placeholder
// words for the boxholder draw a **warning**, not an error, so the todo is still
// collected and shown while the author fixes it. The check ignores case.
void test("assigned is absent for the boxholder's own todos, \"agent\" for the box agent's...", async (t) => {
  t.check(
    validate(parse('{% todo assigned="User" %}\n\ntext\n\n{% /todo %}'), markdocConfig)
      .map((e) => ({ id: e.error.id, level: e.error.level })),
    [
    {
      id: "todo-assigned-boxholder-placeholder",
      level: "warning",
    },
  ],
  );

  t.check(["me", "boxholder", "you", "OWNER"].map((word) => check(`{% todo assigned="${word}" %}\n\ntext\n\n{% /todo %}`)), [
    "todo-assigned-boxholder-placeholder",
    "todo-assigned-boxholder-placeholder",
    "todo-assigned-boxholder-placeholder",
    "todo-assigned-boxholder-placeholder",
  ]);
});

// A person's name and `"agent"` pass.
void test("A person's name and \"agent\" pass.", async (t) => {
  t.check([check('{% todo assigned="Dana" %}\n\ntext\n\n{% /todo %}'), check('{% todo assigned="agent" %}\n\ntext\n\n{% /todo %}')], [
    "valid",
    "valid",
  ]);
});

// Card lint reports it as a warning on any card body.
void test("Card lint reports it as a warning on any card body.", async (t) => {
  const { lintBodyMarkdoc } = await import("../../src/core/body-markdoc-lint.js");
  t.check(lintBodyMarkdoc('{% todo assigned="user" %}\n\nCall the vet\n\n{% /todo %}').map((issue) => issue.severity), [
    "warning",
  ]);
});

// The frontmatter `todos:` form of a todo gets the same warning.
void test("The frontmatter todos: form of a todo gets the same warning.", async (t) => {
  const { lintFrontmatterTodoAssigned } = await import("../../src/core/body-markdoc-lint.js");
  t.check(
    lintFrontmatterTodoAssigned({ todos: [{ text: "Call the vet", assigned: "Dana" }, { text: "Pay the bill", assigned: "me" }] })
      .map((issue) => ({ severity: issue.severity, entry: issue.message.split(":")[0] })),
    [
    {
      severity: "warning",
      entry: "todos[1]",
    },
  ],
  );
});

// ## `see-also` nested inside a todo, with a reason and a `ref`
//
// Markdoc's HTML renderer lowercases attribute names (`sourceRef` → `sourceref`)
// — a rendering-layer quirk, not a data-layer one; React's `renderers.react`
// (used at runtime) preserves the case, which is what the `SeeAlso` component
// (`components/SeeAlso.tsx`) actually receives as `props.sourceRef`.
void test("Markdoc's HTML renderer lowercases attribute names (sourceRef → sourceref) —...", async (t) => {
  t.check(render('{% todo id="vet-refill" %}\n\nCall the vet\n\n{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}\n\n{% /todo %}'), "<article><TodoBlock id=\"vet-refill\"><p>Call the vet</p><p><SeeAlso sourceref=\"people/dana.person.card\">Dana offered to pick it up</SeeAlso></p></TodoBlock></article>");
});

// ## `see-also` with an external `href` (no `ref` → `sourceRef` rename applies)
void test("`see-also` with an external `href` (no `ref` → `sourceRef` rename applies)", async (t) => {
  t.check(
    render('{% see-also href="https://example.com/thread" %}the original request{% /see-also %}')
    ,
    "<article><p><SeeAlso href=\"https://example.com/thread\">the original request</SeeAlso></p></article>",
  );
});

// ## `see-also` with neither `ref` nor `href` is an error
void test("`see-also` with neither `ref` nor `href` is an error", async (t) => {
  t.check(check("{% see-also %}dangling reason{% /see-also %}"), "see-also-missing-target");
});

// ## `see-also` with both `ref` and `href` is an error
void test("`see-also` with both `ref` and `href` is an error", async (t) => {
  t.check(
    check('{% see-also ref="a.card" href="https://example.com" %}ambiguous{% /see-also %}')
    ,
    "see-also-ambiguous-target",
  );
});

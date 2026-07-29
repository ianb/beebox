# Markdoc `{% todo %}` / `{% see-also %}` — parse/validate/transform

`todo` is the universal capture-in-place annotation
(`docs/plans/todo-annotation.md`); `see-also` nests inside it and points at
supporting context. Both delegate attribute validation to
`todo-model.ts`'s `validateTodoAttributes` — this doctest exercises the
Markdoc-level wiring (schema `matches`, `validate()`, and the transform's
tag names / `ref` → `sourceRef` rename), not the date-math rules themselves
(covered by `todo-model.doctest.md`).

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config.js";

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
```

## A valid todo, block form

```ts
render('{% todo id="vet-refill" assigned="Dana" due="2026-08-01" %}\n\nCall the vet about the prescription refill\n\n{% /todo %}')
=>
<article><TodoBlock id="vet-refill" assigned="Dana" due="2026-08-01"><p>Call the vet about the prescription refill</p></TodoBlock></article>
```

## A valid todo, inline form

```ts
render("Remember to {% todo %}call the vet{% /todo %} today.")
=>
<article><p>Remember to <TodoInline>call the vet</TodoInline> today.</p></article>
```

## Bare `{% todo %}` (no attributes) is a valid open todo

```ts
check("{% todo %}\n\nJust a plain todo\n\n{% /todo %}")
=>
valid
```

## `status` enum rejects a typo

`matches` is Markdoc's own built-in attribute-enum check (`attribute-value-invalid`) — the schema hands it the `TODO_STATUSES` list from `todo-model.ts` rather than restating the enum.

```ts
check('{% todo status="Done" %}\n\ntext\n\n{% /todo %}')
=>
attribute-value-invalid
```

## Valid status values all pass

```ts
check('{% todo status="open" %}\n\ntext\n\n{% /todo %}')
=>
valid

check('{% todo status="done" %}\n\ntext\n\n{% /todo %}')
=>
valid

check('{% todo status="dropped" %}\n\ntext\n\n{% /todo %}')
=>
valid

check('{% todo status="parked" %}\n\ntext\n\n{% /todo %}')
=>
valid
```

## Relative `start` without `due` is a validate() error

```ts
check('{% todo start="-3d" %}\n\ntext\n\n{% /todo %}')
=>
todo-relative-start-requires-due
```

## `start` after `due` (both absolute) is a validate() error

```ts
check('{% todo due="2026-08-01" start="2026-08-05" %}\n\ntext\n\n{% /todo %}')
=>
todo-start-after-due
```

## `by="agent"` without `created` is a validate() error

```ts
check('{% todo by="agent" %}\n\ntext\n\n{% /todo %}')
=>
todo-agent-requires-created

check('{% todo by="agent" created="2026-07-28" %}\n\ntext\n\n{% /todo %}')
=>
valid
```

## `see-also` nested inside a todo, with a reason and a `ref`

Markdoc's HTML renderer lowercases attribute names (`sourceRef` → `sourceref`)
— a rendering-layer quirk, not a data-layer one; React's `renderers.react`
(used at runtime) preserves the case, which is what the `SeeAlso` component
(`components/SeeAlso.tsx`) actually receives as `props.sourceRef`.

```ts
render('{% todo id="vet-refill" %}\n\nCall the vet\n\n{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}\n\n{% /todo %}')
=>
<article><TodoBlock id="vet-refill"><p>Call the vet</p><p><SeeAlso sourceref="people/dana.person.card">Dana offered to pick it up</SeeAlso></p></TodoBlock></article>
```

## `see-also` with an external `href` (no `ref` → `sourceRef` rename applies)

```ts
render('{% see-also href="https://example.com/thread" %}the original request{% /see-also %}')
=>
<article><p><SeeAlso href="https://example.com/thread">the original request</SeeAlso></p></article>
```

## `see-also` with neither `ref` nor `href` is an error

```ts
check("{% see-also %}dangling reason{% /see-also %}")
=>
see-also-missing-target
```

## `see-also` with both `ref` and `href` is an error

```ts
check('{% see-also ref="a.card" href="https://example.com" %}ambiguous{% /see-also %}')
=>
see-also-ambiguous-target
```

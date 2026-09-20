# Pure todo extraction (`core/todo/extract.ts`)

`extractCardTodos` turns ONE card's text into todo items. It reads no clock,
no timezone, and no other card — that is what lets a cache sit in front of it
(`docs/plans/todo-collection.md`, Track 2), and it is why plate-state is a
separate `deriveTodo` step.

What an item keeps beyond the tag's own attributes is the context an undated
todo needs to mean anything: the heading path above it (`sectionPath`), the
todo whose list item contains it (`parent`), the words written after the
closing tag (`annotation`), and whatever it points at (`refs`).

```ts setup
import { extractCardTodos } from "../../src/core/todo/extract.js";
import { deriveTodo } from "../../src/core/todo/derive.js";
import { buildLoadContext } from "../../src/core/load-context.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const box = await makeTmpBox();
const ctx = await buildLoadContext(box.root);

// Four frontmatter lines, so body line 1 is file line 5.
function memo(body: string): string {
  return `---\nstatus: new\ncreated: 2026-07-01T10:00:00Z\n---\n${body}`;
}

/** One line per todo: `line [section path] parent "text" ann="…" refs=…` */
function show(relPath: string, body: string): string {
  const { items, issues } = extractCardTodos({ relPath, content: memo(body), ctx });
  if (issues.length > 0) return issues.map((i) => `[${i.kind}] ${i.message}`).join("\n");
  return items
    .map((item) => {
      const where = item.locator.kind === "body" ? String(item.locator.line) : `fm[${String(item.locator.index)}]`;
      const parent = item.parent === null ? "-" : item.parent.kind === "body" ? String(item.parent.line) : "fm";
      return [
        where,
        `[${item.sectionPath.join(" / ")}]`,
        `parent=${parent}`,
        JSON.stringify(item.text),
        `ann=${JSON.stringify(item.annotation)}`,
        `refs=${item.refs.join(",")}`,
      ].join(" ");
    })
    .join("\n");
}

const CARD = "_content/projects/Kitchen.memo.card";
```

## The heading path above a todo, outermost first

A deeper heading extends the path; a shallower one resets everything below it.
The heading's own inline markup is flattened to text, exactly as a todo's body
is.

```ts
show(CARD, [
  "# House",
  "",
  "## Shop *soon*",
  "",
  "### Tools",
  "",
  "- {% todo %}Drill bits{% /todo %}",
  "",
  "## Garden",
  "",
  "- {% todo %}Prune the plum{% /todo %}",
  "",
  "{% todo %}Above no heading is a different card{% /todo %}",
].join("\n"))
=>
11 [House / Shop soon / Tools] parent=- "Drill bits" ann="" refs=
15 [House / Garden] parent=- "Prune the plum" ann="" refs=
17 [House / Garden] parent=- "Above no heading is a different card" ann="" refs=
```

A todo written before the first heading has an empty `sectionPath`, and a
document that starts deep simply has fewer entries — skipped levels compact
out rather than leaving holes.

```ts continue
show(CARD, [
  "{% todo %}No heading yet{% /todo %}",
  "",
  "### Only a deep one",
  "",
  "{% todo %}Under it{% /todo %}",
].join("\n"))
=>
5 [] parent=- "No heading yet" ann="" refs=
9 [Only a deep one] parent=- "Under it" ann="" refs=
```

A todo written *inside* a heading is still collected. It belongs to the
sections ABOVE that heading rather than naming itself, its annotation is the
rest of the heading line, and the heading still names the section for
everything that follows — flattened the same way any heading is, with the
todo's own words left out and the annotation's kept.

```ts continue
show(CARD, [
  "# House",
  "",
  "## Shop {% todo %}Decide the list{% /todo %} — before Saturday",
  "",
  "- {% todo %}Drill bits{% /todo %}",
].join("\n"))
=>
7 [House] parent=- "Decide the list" ann="before Saturday" refs=
9 [House / Shop — before Saturday] parent=- "Drill bits" ann="" refs=
```

## Nesting: a todo's parent is the todo that owns its list item

The nested list is a *sibling* of the parent todo's `inline` under the same
`item`, not a child of the todo tag — so the parent's text stops where it
should, and the relationship has to be read from item ancestry.

```ts continue
show(CARD, [
  "- {% todo %}Sell the piano{% /todo %}",
  "  - {% todo %}Get it appraised{% /todo %}",
  "    - {% todo %}Call Marisol{% /todo %}",
].join("\n"))
=>
5 [] parent=- "Sell the piano" ann="" refs=
6 [] parent=5 "Get it appraised" ann="" refs=
7 [] parent=6 "Call Marisol" ann="" refs=
```

An enclosing item with no todo of its own is skipped rather than breaking the
chain: a plain organizing bullet does not become a parent, and its children
keep whatever todo was above it.

```ts continue
show(CARD, [
  "- {% todo %}Kitchen{% /todo %}",
  "  - plain grouping bullet",
  "    - {% todo %}Replace the tap{% /todo %}",
  "- another plain bullet",
  "  - {% todo %}Top-level after all{% /todo %}",
].join("\n"))
=>
5 [] parent=- "Kitchen" ann="" refs=
7 [] parent=5 "Replace the tap" ann="" refs=
9 [] parent=- "Top-level after all" ann="" refs=
```

Note the last line: an item with no todo leaves `parent` at whatever the walk
carried in, which at the top level is `null`.

In a LOOSE list the item's first paragraph is often plain prose and the todo
is in a later one. The owner is the last todo written before the nested list,
which is what makes that shape work.

```ts continue
show(CARD, [
  "- Some context about the move.",
  "",
  "  {% todo %}Book the van{% /todo %}",
  "",
  "  - {% todo %}Measure the doorway{% /todo %}",
].join("\n"))
=>
7 [] parent=- "Book the van" ann="" refs=
9 [] parent=7 "Measure the doorway" ann="" refs=
```

## A block-form todo is the parent of the todos inside it, and its text stops at them

This is the one shape where the old flat walk merged a child's words into its
parent's text.

```ts continue
show(CARD, [
  "{% todo %}",
  "Move the studio",
  "",
  "- {% todo %}Pack the kiln{% /todo %}",
  "{% /todo %}",
].join("\n"))
=>
5 [] parent=- "Move the studio" ann="" refs=
8 [] parent=5 "Pack the kiln" ann="" refs=
```

## The annotation is what follows the closing tag in the same paragraph

Its leading separator punctuation — the " — " or ": " a human writes to attach
the note — is trimmed, so the annotation reads as its own phrase. A block-form
todo has no same-paragraph siblings, so its annotation is `""` (above).

```ts continue
show(CARD, [
  "- {% todo %}Sell the piano{% /todo %} — Tomas thinks it needs tuning first",
  "- {% todo %}Call the tuner{% /todo %}",
  "- {% todo %}Book a van{% /todo %}: ask about the stairs",
].join("\n"))
=>
5 [] parent=- "Sell the piano" ann="Tomas thinks it needs tuning first" refs=
6 [] parent=- "Call the tuner" ann="" refs=
7 [] parent=- "Book a van" ann="ask about the stairs" refs=
```

When one paragraph holds two todos, the first one's annotation stops where the
second begins — it never swallows the next todo's note. By the owner rule the
LAST of them owns the item, so the nested todo hangs off it.

```ts continue
show(CARD, [
  "- {% todo %}Appraise{% /todo %} — ask Marisol {% todo %}Insure{% /todo %} — before the move",
  "  - {% todo %}Get the policy number{% /todo %}",
].join("\n"))
=>
5 [] parent=- "Appraise" ann="ask Marisol" refs=
5 [] parent=- "Insure" ann="before the move" refs=
6 [] parent=5 "Get the policy number" ann="" refs=
```

Both todos on line 5 share a locator, which is the honest answer: a body
locator is a line, and the nested todo names that line as its parent.

## References: `see-also` refs and markdown links, resolved against the card

A link's target survives only because it is read from the `link` node's
`href` while the tree is still a tree — flattening keeps the label and throws
the href away. Links inside the todo's own text and links in the annotation
both count, in order of appearance.

```ts continue
show(CARD, [
  "- {% todo %}Sell [the piano](../Piano.memo.card){% /todo %} — see [the appraisal](/_content/Appraisal.memo.card)",
  '- {% todo %}Insure it {% see-also ref="Insurance.memo.card" %}policy{% /see-also %}{% /todo %}',
].join("\n"))
=>
5 [] parent=- "Sell the piano" ann="see the appraisal" refs=_content/Piano.memo.card,_content/Appraisal.memo.card
6 [] parent=- "Insure it" ann="" refs=_content/projects/Insurance.memo.card
```

A relative ref resolves against the card's own directory and a box-root ref
against the box, exactly as `resolveRefPath` says. Nothing is checked for
existence: a reference scope matches on the string, and a todo pointing at a
card that was deleted should still say so.

External targets and refs that leave the box namespace drop out — reporting a
broken link is `bbx validate`'s job, not extraction's.

```ts continue
show(CARD, [
  "- {% todo %}Read [the manual](https://example.com/manual){% /todo %} and [this anchor](#later)",
  "- {% todo %}Escape [upward](../../../../etc/passwd){% /todo %}",
  "- {% todo %}Outside the namespace [here](/src/index.ts){% /todo %}",
].join("\n"))
=>
5 [] parent=- "Read the manual" ann="and this anchor" refs=
6 [] parent=- "Escape upward" ann="" refs=
7 [] parent=- "Outside the namespace here" ann="" refs=
```

Refs are deduped in order of first appearance.

```ts continue
show(CARD, [
  "- {% todo %}Two links to [one card](Piano.memo.card){% /todo %} — and [again](./Piano.memo.card)",
].join("\n"))
=>
5 [] parent=- "Two links to one card" ann="and again" refs=_content/projects/Piano.memo.card
```

## Frontmatter todos have no body position

They carry `sectionPath: []`, `parent: null`, `annotation: ""`, and take their
refs from their own `see-also` entries.

```ts continue
const fm = extractCardTodos({
  relPath: CARD,
  content: [
    "---",
    "status: new",
    "created: 2026-07-01T10:00:00Z",
    "todos:",
    '  - text: "Renew the permit"',
    "    see-also:",
    '      - ref: "/_content/Permit.memo.card"',
    '      - href: "https://example.com/forms"',
    "---",
    "",
  ].join("\n"),
  ctx,
});
JSON.stringify(fm.items.map((i) => ({ sectionPath: i.sectionPath, parent: i.parent, annotation: i.annotation, refs: i.refs })))
=> [{"sectionPath":[],"parent":null,"annotation":"","refs":["_content/Permit.memo.card"]}]
```

## Extraction is pure: the clock cannot reach it

The same card text gives the same items under any frozen clock — there is
nowhere in `extractCardTodos`' input to put a `now`. Only `deriveTodo` sees
one, and that is where plate-state comes from.

```ts continue
const body = '{% todo due="2026-07-27" %}Overdue somewhere{% /todo %}\n';
const a = extractCardTodos({ relPath: CARD, content: memo(body), ctx }).items;
const b = extractCardTodos({ relPath: CARD, content: memo(body), ctx }).items;
JSON.stringify(a) === JSON.stringify(b)
=> true

JSON.stringify(a[0]).includes("plateState")
=> false

const early = { now: new Date("2026-07-01T12:00:00Z"), timeZone: "America/Chicago" };
const late = { now: new Date("2026-08-01T12:00:00Z"), timeZone: "America/Chicago" };
[deriveTodo(a[0], early).plateState, deriveTodo(a[0], late).plateState].join(" → ")
=> on-plate → escalated
```

```ts cleanup
await box.cleanup();
```

# TiddlyWiki markup beside the callback-box equivalent

**Written 2026-08-19.** Companion to [expressing-content.md](expressing-content.md).
TiddlyWiki samples are verbatim from the TiddlyWiki5 repository at `master`
(`5.5.0-prerelease`); callback-box samples are from this checkout.

Each section is one job a box already does, the markup TiddlyWiki uses for it,
and what the difference costs or buys.

---

## 1. Link to another card

```
[[Tiddler Title]]
[[Displayed Link Title|Tiddler Title]]
HelloThere                         ← CamelCase autolinks with no markup at all
~HelloThere                        ← suppressed
[ext[Open file|../README.md]]      ← anything not recognisable as a URL
```

Ours — a path, in a body link or a `ref` field:

```markdown
[The Refactor](/store/projects/Big_Refactor.project.card)
```
```yaml
entries:
  - { ref: /store/projects/Big_Refactor.project.card, label: The Refactor }
```

**The difference is the address.** A tiddler's address is its title, so a link
is the name of the thing and renaming breaks every link (there is a whole
community plugin, `relink`, to fix this). Our address is a path, so `cb mv`
rewrites refs and `cb validate` catches dangling ones — refs are found by
convention, any key named `ref`/`refs` at any depth, plus Markdoc `ref=`
attributes in bodies.

What they get that we don't: **linking is cheaper than not linking.**
CamelCase means the default state of a name in prose is "linked", and you type a
character to opt out. Ours costs a path.

---

## 2. Show one card inside another

```
{{MyTiddler}}                       the whole thing
{{MyTiddler||TemplateTitle}}        rendered through a template
{{||TemplateTitle}}                 apply a template to the current tiddler
{{MyTiddler!!field}}                just one field
{{!!title}}                         one field of whatever is current
{{MyTiddler##index}}                one key of a data tiddler
```

Ours — the embed forms a body can use:

```markdown
![A caption](/store/scans/receipt.image.card)
{% see-also ref="people/Dana_Whitfield.person.card" %}Dana offered to pick it up{% /see-also %}
```

**Two gaps show up here.**

First, transclusion is the *default* move in TiddlyWiki and a special case for
us. `{{X}}` is shorter than a link; our embed syntax is longer than a link and
only some renderers honour it.

Second, and more interesting: **we have no inline field reference.**
`{{MyTiddler!!field}}` and `{{!!title}}` let prose pull a single frontmatter
value out of a card — its own or another's — and have it stay live. A memo that
says "serves {{!!serving}}" cannot be written here. Whether that is a lack or a
deliberate simplification is a real question; it is the smallest possible
version of "a card body can compute", and everything else in this file is built
on it.

---

## 3. A card whose content is a live query

This is the closest correspondence in the whole review, and we already have it.

TiddlyWiki:

```
{{{ [tag[todo]!tag[done]sort[due]] }}}
{{{ [tag[todo]!tag[done]sort[due]]||$:/my/TodoRow }}}
```

which the docs say desugars to exactly:

```
<$list filter="[tag[todo]!tag[done]sort[due]]">
	<$transclude tiddler="$:/my/TodoRow" />
</$list>
```

Ours — `store/plate.todo-view.card`, a frontmatter-only card that *is* a query:

```yaml
---
glob: "store/projects/kitchen-remodel/**"
status: [open, parked]
assigned: agent
---
```

**We already built a filtered transclusion; we built exactly one of them.**
`todo-view`'s three fields are a query, the renderer runs it on every open, and
omitting `glob` scopes it to the card's own subtree. That is a collection view
with a shipped built-in query — the issue's own "cheapest coherent version",
already working, for one card type.

The difference is generality, and it cuts both ways. Theirs is one mechanism for
every collection; ours is one card type per collection shape, which is precisely
why `todo-view`, `nav` and `tab-arrangement` all exist separately. Theirs pays
for it in the other direction: `[tag[todo]]` is unvalidated text, and a typo
gives an empty list.

---

## 4. Grouped collections with labels

`$:/core/macros/timeline` — verbatim, and worth reading closely because it is
the whole "eclectic collection" problem solved in fifteen lines:

```
\procedure timeline-title() <$view field="title"/>
\procedure timeline-link() <$link to={{!!title}}><<timeline-title>></$link>
\procedure timeline(limit:"100",format:"DDth MMM YYYY",subfilter:"",dateField:"modified")
<div class="tc-timeline">
<$set name="tv-tids" filter=`[!is[system]$(subfilter)$has<dateField>!sort<dateField>limit<limit>]`>
<$list filter="[enlist<tv-tids>eachday<dateField>]">
<div class="tc-menu-list-item">
<$view field=<<dateField>> format="date" template=<<format>>/>
<$list filter=`[enlist<tv-tids>sameday:$(dateField)${!!$(dateField)$}]`>
<div class="tc-menu-list-subitem">
<<timeline-link>>
</div>
</$list>
</div>
</$list>
</$set>
</div>
\end
```

Called as `<<timeline>>`, or `<<timeline subfilter:"[tag[memo]]" dateField:"created">>`.

Four things it does that our collection design has to do:

- **Ships its own query**, parameterised — `subfilter` and `dateField` narrow it
  without the caller writing the whole filter.
- **Groups and labels** — outer list over `eachday`, the label is the group key
  rendered through a date format, inner list re-queries that day's members.
- **Appears only where there is content** — no items in a day, no day heading.
  No configuration expresses this; it falls out of `eachday`.
- **Lets the caller override the item rendering**, via a comment in the source:

  > Override one or both of the following two macros with a global or local
  > macro of the same name if you need to change how titles are displayed on a
  > timeline

  Redefine `\procedure timeline-title()` in scope and every timeline below it
  renders differently. That is per-use-site item rendering with no parameter
  passing and no registration — shadowing by name.

We have no equivalent of any of this yet. The `(label, query, view)` triple in
the issue is asking for what this macro hardcodes.

---

## 5. Give a card type its own interface

Ours — a box-local view, from `docs`:

```tsx
export const name = "Sandbox";
export const description = "Interactive sandbox card UI";
export const dependencies = ["**/*.sandbox.card"];
export const modes = ["page", "chat"];
export const rendersCardTypes = ["sandbox"];

export default function Sandbox({ cards, navigate, boxSlug, params }) {
  const card = cards.find(c => c.path === params.path);
  …
}
```

TiddlyWiki — a rule tiddler tagged into the view-template-body cascade, whose
text is a filter:

```
[type[application/x-sandbox]then[$:/my/SandboxTemplate]]
```

**`dependencies` is our filter, and it is doing more work than it looks.** A
view declares glob patterns and receives the matching cards as a prop — that is
a selection expression feeding a rendering, which is `<$list filter>` with the
filter language replaced by globs. We already have the shape; we have it once,
at view granularity, and it is not addressable or composable.

The pieces line up like this:

| Job | TiddlyWiki | callback-box |
|---|---|---|
| Select a set | filter expression | `dependencies` globs; `cb search --kind --path` |
| Render the set | `<$list>` | the view component's own JSX |
| Render one item | `template` / widget body / default link | `file-type-registry` priority chain |
| Pick the item renderer | cascade (filter-conditioned, neighbour-ordered) | `registerFileType({type}, {priority})` + `rendersCardTypes` |

The row that differs most is the last. Ours:

```tsx
registerFileType({ type: "image" }, {
  renderer: { name: "Image", Component: ImageCardRenderer, priority: 50 },
});
```

Theirs, from the real `$:/core/ui/ViewTemplate/tags` — a cascade run inline in
the template, falling back to a default:

```
<$transclude tiddler={{{ [<currentTiddler>]
  :cascade[all[shadows+tiddlers]tag[$:/tags/ViewTemplateTagsFilter]!is[draft]get[text]]
  :and[!is[blank]else[$:/core/ui/ViewTemplate/tags/default]] }}} />
```

Unreadable, and it makes three things possible that `priority: 50` does not:
the condition can be any predicate rather than type equality, a new rule places
itself relative to a *named neighbour* rather than guessing a number, and the
resolved chain is inspectable at runtime (Control Panel → Info → Advanced →
Cascades).

---

## 6. Add something to the app's chrome

Ours — `nav.card` at the box root, a validated schema:

```yaml
---
entries:
  - { href: /questions }
  - { href: /chat, label: Recent }
  - { ref: /store/projects/Big_Refactor.project.card, label: The Refactor }
---
```

Theirs — create a tiddler, tag it. That is the entire mechanism, across ~60
documented insertion points (`$:/tags/SideBar`, `$:/tags/PageControls`,
`$:/tags/ViewTemplate`, `$:/tags/Stylesheet`, …):

```
title: $:/my/SidebarTab
tags: $:/tags/SideBar
caption: Recipes

{{{ [tag[recipe]sort[title]] }}}
```

Ordering among tagged tiddlers is not a number — it is the tag tiddler's `list`
field, then per-item `list-before` / `list-after` fields naming a neighbour,
then alphabetical.

**Ours is better typed and worse at composition.** `nav.card` validates `href`
against the real route table and reports a health warning when the card is
broken; theirs accepts anything and shows a blank tab. But ours reaches exactly
one insertion point, and adding a second means a second schema — whereas there,
"the sidebar accepts contributions" and "the card body accepts contributions"
are the same sentence with a different tag.

---

## 7. Search

```
cb search "leaky faucet" --kind memo --path store/projects/ --limit 20
```

```
[search[leaky faucet]tag[memo]prefix[store/projects/]limit[20]]
[all[tiddlers]is[image]!has[caption]sort[created]]
```

Same job, and the second line shows what the difference gets you: `!has[caption]`
is a predicate we cannot express, over a field no one declared, composed with
everything else. `cb search` has three fixed axes — text, kind, path prefix —
each a flag.

The trade is exactly the one this whole review keeps landing on: their
composability comes from having no schema, and a fourth axis for us is a code
change while for them it is another operator in the same brackets.

---

## What this suggests, concretely

Two things are cheap and would move the collection-views design forward:

1. **Generalise `todo-view`'s shape rather than inventing one.** It is already
   a card whose frontmatter is a query and whose renderer runs it live. The
   question the issue is stuck on — where a collection lives, given views attach
   to cards — has a working answer sitting in the box: *the collection is a
   card*. `todo-view`, `nav` and `tab-arrangement` are three instances of it.

2. **Take the label from the group key first.** Group-by-a-field (the timeline
   and Types-tab pattern) yields a labelled, self-hiding, zero-configuration
   collection with no query language and no label authoring. The authored label
   ("untriaged") is the harder half and can follow.

And one worth deciding rather than defaulting: **inline field references in card
bodies** (`{{!!serving}}`). We do not have them, everything above assumes them,
and it is the smallest place where "a card body can compute" begins.

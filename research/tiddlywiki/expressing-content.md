# TiddlyWiki: how it expresses content

**Written 2026-08-19.** Sources are primary: the TiddlyWiki5 repository at
`master` (`5.5.0-prerelease`) — both the documentation tiddlers under
`editions/tw5.com/tiddlers/` and the implementation under `core/modules/`.
Quotes are from those tiddlers; code samples are verbatim unless marked.

Written to inform [collection views](../../issues/features/2026-08-19-collection-views-are-badly-defined.md).
Companion note on the extension surface: [plugins.md](plugins.md).

---

## 0. The shape you need to know to read the rest

A **tiddler** is a record of named string fields. `title` is the primary key,
`text` is the body, `type` is a content type (`text/vnd.tiddlywiki`,
`text/markdown`, `image/png`), `tags` is a list-valued field, and any other
field name is allowed — "Field names may contain any combination of
characters". There is one flat title namespace and no directories. System
tiddlers are a naming convention: a title beginning `$:/`.

Everything is a tiddler. The user interface is tiddlers, configuration is
tiddlers, JavaScript modules are tiddlers, plugins are tiddlers containing
tiddlers. There is exactly one kind of thing, and every mechanism below is a
mechanism over that one kind of thing.

The stated ambition, from `about/Philosophy of Tiddlers.tid`:

> we maximise the possibilities for re-use by slicing information up into the
> smallest semantically meaningful units with rich modelling of relationships
> between them. Then we use aggregation and composition to weave the fragments
> together to present narrative stories.
>
> TiddlyWiki aspires to provide an **algebra for tiddlers**, a concise way of
> expressing and exploring the relationships between items of information.

That is the design goal, and the filter language is the algebra.

---

## 1. Filters — the query language

### 1.1 The general model

From `Introduction to filter notation`:

> The simplest case is where you already know exactly which tiddlers you want.

```
[[Recipe book]] [[ScrambledEggs]] [[Mom's apple pie]]
```

Double brackets are shorthand for `[title[ScrambledEggs]]`, which gives the
general model:

```
[operator[parameter]]
```

So:

```
[tag[Recipe]]                    all tiddlers tagged Recipe
[!tag[Recipe]]                   negation: the ! goes before the operator
[field:serving[4]]               any tiddler whose `serving` field is 4
[serving[4]]                     `field:` is optional for non-operator names
```

The last line is worth pausing on. Because fields are arbitrary and operators
are a fixed vocabulary, an unrecognised operator name is silently reinterpreted
as a field lookup. This is what makes short filters read well, and it is also
why a typo in an operator name produces an empty result rather than an error.

### 1.2 Runs: AND within, OR across

Several steps inside one pair of brackets form a **run**, and a tiddler must
match all of them:

```
[tag[Vegetarian]!tag[soup]serving[4]]
```

> A tiddler has to match //all// of the steps in a run.

Separate runs union:

```
[serving[3]] [serving[4]] [serving[5]]
[serving[3]] [serving[4]!tag[Vegetarian]] [serving[5]]
```

Each step's output is the next step's input. Each *run* starts fresh from the
whole wiki unless prefixed. That default matters: it is why the union case is
the cheap one and the intersection case needs a prefix.

### 1.3 Run prefixes — the compositional layer

```
[serving[3]] [serving[4]] [serving[5]] +[tag[Vegetarian]] +[sort[title]]
[tag[Vegetarian]] -[title[ScrambledEggs]] -BeansOnToast
```

The full shortcut set, from `Shortcut Filter Run Prefix`:

| Prefix | Effect |
|---|---|
| *(none)* | output is "dominantly appended" to the filter's output (union, de-duplicated) |
| `+` | receives the filter output so far as input; its output **replaces** everything so far |
| `-` | its output titles are **removed** from the result so far |
| `~` | applies **only if** the result so far is empty — an else/fallback |
| `=` | appends **without de-duplication** |
| `=>` | (5.4.0) assigns the accumulated results to a named multi-valued variable and clears them |

Since 5.1.23 there are named equivalents plus several that have no shortcut
form: `:and` `:except` `:else` `:all` `:or` `:intersection` `:filter` `:map`
`:reduce` `:sort` `:cascade` `:let` `:then`. The named ones are where the
language stops being a set-selector and becomes a small functional pipeline:

```
[tag[shopping]] :reduce[get[quantity]add<accumulator>]
:map[{!!price}multiply{!!cost}]
:filter[{!!price}multiply{!!cost}compare:integer:gteq[5]]
:sort:number:reverse[{!!value}divide{!!cost}]
:map[get[caption]else{!!title}]
```

Inside these runs, `currentTiddler` is bound to the item being processed, and
`..currentTiddler` reaches the enclosing binding. `index`, `revIndex`, `length`
and (for `:reduce`) `accumulator` are also bound. This is map/filter/reduce with
lexical scope, written in brackets.

One subtlety worth stealing the *distinction* even if not the syntax —
`:intersection` vs `:and`:

> `:and` / `+` feeds the **accumulated results so far** as input to the filter
> run. Operators in the run can only see and work with titles already in the
> results. `:intersection` feeds **all tiddler titles** as input to the filter
> run (just like an unprefixed run), then keeps only titles that also appear in
> the accumulated results.

That difference exists because some operators (`tag`, `all`) construct a
selection from the whole wiki rather than filtering their input. The language
has to expose *where the input comes from* because operators are not uniform in
that respect. Any query language with both "select from everything" and "narrow
what I have" operators inherits this problem.

### 1.4 Three kinds of bracket — the late-binding trick

```
[tag[Vegetarian]]        literal
[tag{Preference}]        TextReference — the text field of the tiddler `Preference`
[search<currentTiddler>] variable
```

> Note that these special brackets cannot be nested. It is not possible for
> example to write `[search{<currentTiddler>}]`.

The four parameter forms, from `Filter Parameter`, are delimiters around a name
— closer to quote marks than to tags, and none of them close:

```
[like this]     hard      — the literal text between the brackets
{like this}     indirect  — a TextReference: a field of a tiddler
<like this>     variable  — the current value of that variable
(like this)     5.4.0     — a multi-valued variable, all values
```

**The same characters mean different things inside a filter than outside it,
and nothing marks the boundary.** This is the concrete source of the
readability cost catalogued in §6 — not density, but unannounced context
switching:

| Form | In wikitext | In a filter |
|---|---|---|
| `<name>` | — | variable parameter |
| `<<name>>` | transclude a variable's value | — |
| `<$list …>` | widget element (closes) | — |
| `[[Foo]]` | a link | a title, short for `[title[Foo]]` |
| `{X}` | — | TextReference parameter |
| `{{X}}` | transclusion | — |
| `{{{X}}}` | filtered transclusion (all results) or filtered attribute value (first result), by position | — |

So `[<currentTiddler>]` is one step with no operator and a variable parameter,
which — per `Filter Step`, *"If a step's operator and suffix are omitted
altogether, it defaults to the title operator"* — means
`[title<currentTiddler>]`: the tiddler whose title is the current value of that
variable. It reads like an unclosed tag and is neither a tag nor unclosed.

Curly and angle brackets are what make a filter a *live* query rather than a
frozen one: the parameter is read at evaluation time from wiki state. A saved
filter tiddler plus a parameter tiddler is a parameterised saved query, with no
"saved query" feature having been built.

### 1.5 The operator surface

173 operators are documented as `[[Filter Operators]]` (83 implementation files
under `core/modules/filters/`; several export more than one). They cover far
more than selection:

- **Selection constructors** — `all[tiddlers]`, `all[shadows]`, `all[current]`,
  `tag[x]`, `title[x]`, `list[x]`
- **Predicates** — `is[image]`, `is[system]`, `is[draft]`, `has[field]`,
  `prefix[]`, `suffix[]`, `regexp[]`, `search[]`
- **List surgery** — `first` `last` `rest` `butlast` `nth` `limit` `unique`
  `reverse` `putfirst` `insertbefore` `move` `append`
- **Ordering** — `sort` `nsort` `sortcs` `sortan` `sortsub` `order`
- **Grouping** — `each` (see §5), `eachday`, `sameday`
- **Strings and arithmetic** — `addprefix` `split` `format` `pad` `levenshtein`,
  `add` `multiply` `divide` `sum` `median` `standard-deviation`
- **JSON** — `jsonget` `jsonset` `jsonindexes` — because a tiddler field can
  hold JSON and the language grew operators rather than a second data model
- **Graph** — `links` `backlinks` `transcludes` `backtranscludes` `tagging`

`is` and `all` are the pair that answers "does the platform know about
categories": `is[image]` matches "has an image ContentType", `is[binary]`,
`is[system]`, `is[tag]`. The vocabulary of built-in categories is small and
fixed; everything else is a field or a tag.

### 1.6 What a filter is, structurally

A filter is a **pipeline over an ordered list of strings**. Not a relational
query, not a graph query, not a predicate over records. Its input is a list of
titles, its output is a list of titles, and every operator is a
`(list, operand, options) -> list` function. The whole implementation of `tag`
is 35 lines of exactly that shape, with an optional index fast path.

Consequences that fall straight out of the type:

- **Composition is free** — any operator can follow any operator, because the
  types always line up. This is most of why the language feels large without
  being complicated.
- **Everything is a string.** `:sort:number` exists because sorting has to be
  told what the strings mean. There is no schema and no validation.
- **There are no joins.** Relations are traversed one hop at a time by an
  operator that knows how (`links`, `tagging`, `list`), never expressed
  generically.
- **There is no grouping.** `each` returns one representative title per distinct
  field value — a list of group *keys*, not groups. Actual grouping is done by
  nesting two list widgets (§5).
- **Errors are empty lists.** A wrong result and no result look the same, and
  neither looks like a mistake.
- Recursion is bounded at depth 300, returning
  `/**-- Excessive filter recursion --**/`.

---

## 2. Widgets, and how a set becomes a rendering

### 2.1 The list widget

```
<$list filter="[tag[ListWidget]sort[title]]"/>
```

With the item rendering supplied inline:

```
<$list filter="[tag[ListWidget]sort[title]]">
<<currentTiddler>>
{{||$:/core/ui/ViewTemplate/tags}}
</$list>
```

With the item rendering named as a tiddler:

```
<$list filter="[tag[ListWidget]sort[title]]" template="$:/core/ui/ViewTemplate/subtitle"/>
```

The resolution ladder is the interesting part, quoted verbatim:

> - If the filter evaluates to an empty list, the text of the `emptyMessage`
>   attribute is rendered, and all other templates are ignored
> - Otherwise, if the `template` attribute is specified then it is taken as the
>   title of a tiddler to use as a template for rendering each item of the list
> - Otherwise, if the list widget content is not blank, it is used as a template
>   for rendering each item of the list
> - Otherwise, a default template is used consisting of a `<span>` or `<div>`
>   element wrapped around a link to the item

Four ways to say what an item looks like, ordered from most specific to least,
with a default that is always meaningful — a link. Nothing is ever unrenderable.

Other attributes: `variable` (renames the per-item binding, default
`currentTiddler`), `counter` (1-based index, plus `-first`/`-last` companion
variables), `join` (5.3.2, separator wikitext), `limit` (5.3.2, negative counts
from the end), `storyview` (a named JS module that animates list changes),
`history`. Since 5.3.2 the template and empty cases can be child widgets instead
of attributes:

```
<$list filter="...">
  <$list-template>…</$list-template>
  <$list-empty>Nothing here yet.</$list-empty>
  <$list-join>, </$list-join>
</$list>
```

Two defaults worth noting. The filter defaults to `[!is[system]sort[title]]` —
"everything a person would call content, alphabetically". And the docs warn
that `counter` "can reduce performance when working with list items that
dynamically reorder or update themselves", recommending `join` instead where
possible; the reactive recomputation is real and is not free.

### 2.2 Where item rendering comes from

**The list widget knows nothing about item types.** It transcludes each title
through a template and stops there. There is no per-item type dispatch in the
list widget at all. Type-awareness lives in the *template* — most often by
delegating to a cascade (§4), which is the mechanism that asks "what is this
thing, and what should render it".

That separation is the single cleanest idea in the design: **selection,
iteration, and per-item type dispatch are three different mechanisms that
compose**, and a collection is just the three of them stacked.

---

## 3. Transclusion

The core notation:

```
{{MyTiddler}}                                 include a tiddler
{{MyTiddler||TemplateTitle}}                  include it *through* a template
{{||TemplateTitle}}                           apply a template to the current tiddler
{{MyTiddler|Parameter}}                       with a parameter
{{MyTiddler||TemplateTitle|Param|SecondParam}}
{{MyTiddler!!field}}                          a single field
{{!!field}}                                   a field of the current tiddler
{{MyTiddler##index}}                          an indexed property of a data tiddler
```

The template case is explained with a metaphor worth keeping:

> Transcluding via a template is like applying a mask: assuming that the source
> tiddler contains generic references (like eye holes in a mask), these will be
> replaced with the target tiddlers values (like the eyes of the person who
> wears the mask).

Mechanically: a template is wikitext containing *unqualified* references
(`{{!!title}}`), which resolve against whatever `currentTiddler` is bound to.
A template is an open expression; transclusion closes it. `currentTiddler` is
the whole binding protocol, and it is one variable.

### 3.1 Filtered transclusion — the query that is a link

This is the piece the collection-views issue is circling:

```
{{{ [tag[mechanism]] }}}
{{{ [tag[mechanism]]||TemplateTitle }}}
```

> In contrast to Filtered Attribute Values, all items matching the filter are
> transcluded and not only the first.

And the documentation gives the desugaring, which is the clearest possible
statement of the model:

```
{{{ [tag[mechanism]] }}}
```
expands to
```
<$list filter="[tag[mechanism]]">
	<$link />
</$list>
```

and
```
{{{ [tag[mechanism]]||TemplateTitle }}}
```
expands to
```
<$list filter="[tag[mechanism]]">
	<$transclude tiddler="TemplateTitle" />
</$list>
```

So a query-as-link, in one line of markup, with a default rendering (a list of
links) and an optional supplied rendering. There is no third concept: no
"collection", no "view object", no saved query. `{{{ }}}` is sugar for
`list + template`, and that is all a collection is in this system.

Related, and deliberately different: **filtered attribute values** take the
*first* result of a filter as a string:

```
<$text text={{{ [<currentTiddler>addprefix[$:/myprefix/]] }}} />
```

Same syntax, singular semantics, determined by position. The 5.4.0 additions
`((var))` and `(((filter)))` render values inline joined by a separator.

### 3.2 Missing targets

`$transclude` has a `ts-missing` slot rendered when the target does not exist;
if no slots are given, the widget's own content is the fallback. Absence is a
render case rather than an error — the same posture as the list widget's
`emptyMessage` and its always-available default link template.

---

## 4. Cascades — the type-dispatch mechanism

This is TiddlyWiki's answer to "which renderer handles this item", and it is
the mechanism with the most direct counterpart in our code.

> Cascades provide a means to select one of multiple values based on flexible,
> extensible criteria. They can be thought of as a list of conditions that are
> evaluated in turn until one of them matches.
>
> Each cascade is defined by a special tag which identifies the tiddlers
> containing the conditions to be matched. The Order of Tagged Tiddlers
> determines the order in which the conditions are processed, and provides the
> means for arranging new rules at specific points in the cascade.
>
> The conditions are defined by a Filter Expression in the text field. The
> filters are evaluated with the list of input titles set to the title of the
> tiddler to be considered.

So a cascade is: a tag names the cascade; every tiddler carrying that tag is one
rule; each rule is a filter expression evaluated against the single candidate
title; the first rule returning a non-empty result wins, and its first result is
the answer.

The Story Tiddler Template Cascade in full — two rules:

```
[is[draft]then{$:/config/ui/EditTemplate}]
[{$:/config/ui/ViewTemplate}]
```

The View Template Body Cascade, in the documentation's own words:

> 1. If the tiddler title starts with any of a list of known system tiddler
>    prefixes, use the template `$:/core/ui/ViewTemplate/body/code` …
> 2. If the tiddler has the field `plugin-type` set to `import` then use …
> 3. If the tiddler has the field `plugin-type` then use …
> 4. If the tiddler has the field `hide-body` set to `yes` then use … `/body/blank`
> 5. Otherwise, use the default template `$:/core/ui/ViewTemplate/body/default`

Seven cascades exist in the core: story tiddler template, tiddler icon, tiddler
colour, view template title, view template body, edit template body, field
editor.

Three properties are worth naming separately, because they are separable and we
would not necessarily want all three:

1. **The condition is a filter, not a type equality.** A rule can match on a
   field, a title prefix, a tag, a computed property, or a conjunction of them.
   Type is one predicate among many, not the dispatch key.
2. **Ordering is data, not numbers.** Insertion position comes from Order of
   Tagged Tiddlers: the tag tiddler's `list` field first, then per-rule
   `list-before` / `list-after` fields naming a *neighbour*, then alphabetical.
   A new rule says "just before the default one" instead of guessing a priority
   number.
3. **The whole cascade is inspectable at runtime** — Control Panel → Info →
   Advanced → Cascades shows the current rule list for each.

Compare our `src/frontend/src/file-type-registry.ts`: registration is a call in
code (`registerFileType({ type: "image" }, { renderer: { …, priority: 50 } })`),
the selector is an exact card `type` or a path/data predicate, ordering is a
numeric `priority` (source=10, image=50), and box-local views bind ahead of all
of it via `rendersCardTypes` in `view-bindings.ts`. Same job, three differences:
our condition is narrower, our ordering is a magic number, and our chain is not
visible anywhere in the product.

---

## 5. Grouping, labels, and eclectic collections

The collection-views issue's sharpest constraint — *"here's some images
untriaged, here's some other images"*, where the label carries meaning the query
does not — has a direct TiddlyWiki answer, and it is instructive mostly for what
it does *not* provide.

The "Types" sidebar tab, `$:/core/ui/MoreSideBar/Types`, verbatim:

```
\whitespace trim
<$list filter={{$:/core/Filters/TypedTiddlers!!filter}}>
<div class="tc-menu-list-item">
<$view field="type"/>
<$list filter="[type{!!type}!is[system]sort[title]]">
<div class="tc-menu-list-subitem">
<$link to={{!!title}}><$view field="title"/></$link>
</div>
</$list>
</div>
</$list>
```

Read it as an answer to our design questions:

- The **outer list** produces the group keys — one item per distinct `type` in
  the wiki, via the `each` operator inside the referenced filter tiddler.
- The **label** is `<$view field="type"/>` — the group key rendered as text.
- The **inner list** re-queries for members of that group, `[type{!!type}…]`,
  reading the key back out of the current item with a TextReference.
- The **collection appears only when content exists**: no types, no groups, no
  headings, no configuration anywhere. This is precisely the boxholder's
  "conventional / static" query — *all cards of a type, so long as any exist* —
  and TiddlyWiki gets it for free because `each` over a field enumerates only
  values that occur.

And the parts it does not give you:

- **Grouping is not a feature.** It is two nested list widgets and an `each`.
  `demonstrations/GroupedLists.tid` is a demo page, not a mechanism page.
- **Derived labels only.** The label here *is* the group key. For an authored
  label — "Untriaged", where untriaged is not a value of any field — you write
  two sibling `<$list>` blocks with a heading over each, by hand, in a tiddler.
  That works, and it is invisible to the system: nothing knows those two blocks
  are two views of one source, nothing can enumerate them, nothing can address
  one of them.
- **No addressing.** A collection has no identity. You cannot link to "the
  untriaged images collection"; you can only link to the tiddler that happens to
  contain the markup that renders it.

Our issue's `(label, query, view)` triple is a **stronger** claim than anything
TiddlyWiki makes, and the gap is exactly the part TiddlyWiki leaves to prose.
Its manual ordering story is better than its labelling story: Order of Tagged
Tiddlers gives per-item `list-before` / `list-after` overrides on top of a
derived order, so a mostly-derived list can be hand-arranged without becoming a
hand-authored list.

---

## 6. WikiText as a whole: what it made cheap, what it made expensive

WikiText is described as "designed to be familiar for users of Markdown but
with more of a focus on linking and the interactive features". In practice it
is three languages sharing one file: a lightweight prose markup, an XML-ish
widget language (`<$list>`, `<$transclude>`, 68 documented widgets), and the
filter language, plus a pragma layer (`\define`, `\function`, `\procedure`,
`\widget`, `\whitespace`) for definitions.

**Cheap:**

- **Selecting a set.** `[tag[Recipe]serving[4]]` is shorter than the English.
- **Putting a set on a page with a rendering.** One line:
  `{{{ [tag[recipe]]||$:/my/RecipeCard }}}`.
- **Overriding the item rendering per use site.** Four ways, resolved in a
  documented order, all local to the call.
- **Liveness.** `{{...}}`, `<...>` and reactive recomputation mean nothing is
  ever a stale copy. The docs make this a headline property: results update "as
  tiddlers are added and deleted".
- **Naming things.** A filter is a tiddler; a template is a tiddler; a rendering
  rule is a tiddler with a tag. Every abstraction is created by making a record,
  never by editing a registry.
- **Degrading.** Empty list → `emptyMessage`; no template → a link; missing
  target → `ts-missing`. Every layer has a defined behaviour for "nothing here".

**Expensive:**

- **Types.** There are none. Every value is a string; sorting must be told the
  intended type at the call site (`:sort:number`); a field holding JSON needs a
  dozen dedicated operators to reach into. Nothing can be checked before it runs.
- **Being wrong quietly.** A misspelled operator becomes a field lookup, a
  missing field becomes an empty string, and both produce an empty list — which
  is also what a correct query over an empty wiki produces. The docs repeatedly
  advise defensive coding, e.g. "when retrieving the value of a field with the
  `get` Operator it is helpful to guard against a missing field value using the
  `else` Operator".
- **Reading it.** Five bracket kinds with different meanings (`[]` `{}` `<>`
  `{{{}}}` `[[]]`), prefixes that are punctuation (`+ - ~ = =>`), suffixes
  chained by colons (`:sort:number:reverse`). The 5.1.23 named prefixes were
  added, per the docs, precisely because the shortcuts "are harder to read by
  less experienced users" — the language grew a more verbose surface for its own
  syntax after the fact.
- **Structure.** There is no hierarchy. One flat title namespace, with `$:/`
  prefixes and tag graphs standing in for containment. Path-shaped questions —
  "everything under this directory" — are prefix matches on titles.
- **Scale.** Reactivity is per-widget recomputation over an in-memory store;
  the documentation carries explicit performance advice inside feature
  descriptions (`counter` vs `join`), which is a sign the cost is routinely hit.

The trade is coherent: **one data model, one composition rule, no types.** That
buys an enormous amount of expressiveness per line and pays for it with
unverifiability. Our shape is the opposite — typed cards with schemas, a real
filesystem, TypeScript everywhere — which means several mechanisms below
transfer only if we re-add the type checking TiddlyWiki chose to do without.

---

## 7. Dispositions — what transfers to beebox

### Adopt

**A1. `{{{ query ||template }}}` desugars to `list + item-template`, and that
IS the collection.** The most valuable single finding. TiddlyWiki has no
"collection" object at all: a collection view is the composition of a selection,
an iteration, and a per-item rendering, and the markup is sugar over that
composition. This validates the issue's *"maybe the collection view just ships
with its own built-in queries"* as the cheap first slice, and it argues against
introducing a first-class stored "collection" object early. Traces to
`issues/features/2026-08-19-collection-views-are-badly-defined.md` §"Design
direction".

**A2. Keep selection, iteration, and per-item type dispatch as three separate
mechanisms.** The list widget knows nothing about item types; type dispatch is
the cascade, reached through the template. This is the direct answer to the
issue's "mixed types" section: a collection view that *accepts everything and
degrades per item* is not a compromise, it is what falls out of not putting type
knowledge in the collection layer. Our `file-type-registry` priority chain is
already the per-item half; a collection view should call into it rather than
duplicate typing. Traces to `src/frontend/src/file-type-registry.ts`,
`src/frontend/src/renderers/builtins.tsx`.

**A3. A defined behaviour for "nothing" at every layer.** `emptyMessage` →
`ts-missing` → default link template → the low-priority source renderer. Our
issue asks "does an empty result hide the view or show an empty state?" — the
TiddlyWiki answer is that the *caller* supplies the empty rendering, and there
is always a defined fallback if it does not. Make the empty case an attribute of
the view instance, not a global policy.

### Adapt

**B1. Cascade-style rendering rules, taking the ordering idea and not the filter
idea.** Our numeric `priority: 50` should become neighbour-relative ordering
(`before`/`after` naming another rule) the next time the chain is touched — that
is the part of Order of Tagged Tiddlers that solves a problem we actually have
(what number do I pick?) without adopting a stringly-typed condition language.
The "cascade is inspectable in the product" property is separately worth having:
a page listing the current renderer chain per card type. Traces to
`file-type-registry.ts` and `view-bindings.ts`.

**B2. Derived collections from a group-by, appearing only when non-empty.** The
Types tab is the boxholder's "conventional / static query" already working, and
the mechanism that makes it configuration-free is `each` over a field: groups
that occur, exist. For us that reads as "group cards by `type` (or by any
frontmatter field) and render one labelled group per distinct value present".
That is a smaller and better-defined first feature than a general query
language, and it produces the label as a by-product.

**B3. Late-binding query parameters.** `[tag{Preference}]` — a parameter read
from box state at evaluation time — is how TiddlyWiki gets parameterised saved
queries without a saved-query feature. If a collection view ships its own
queries (the issue's cheapest version), one parameter slot read from the card it
hangs off gets most of the way to reified queries at a fraction of the cost.

### Later

**C1. Manual ordering on top of a derived list.** `list-before` / `list-after`
per item, over a derived order. Directly useful for a collection view once one
exists, and independently useful for card ordering. Not needed for the first
slice.

**C2. An actual filter language.** If reified queries ever land, the run/prefix
model (`+` narrows, `-` subtracts, `~` falls back) is a good compositional
skeleton, and `:intersection` vs `:and` names a real distinction we would hit.
But it is a large surface, and our `bbx search` already covers text + kind +
path prefix (`src/cli/commands/search.ts`). Do not design a query language until
a shipped collection view proves the built-in queries insufficient.

### Reject

**D1. Stringly-typed everything.** The typing constraint in the issue —
*"if your query gave unrenderable items, that's not very helpful"* — is a
constraint TiddlyWiki cannot express and does not try to. We have `rendersCardTypes`
and `bbx view-lint` enforcing that every view attaches to a type; that is a real
advantage and the collection design should extend it (declare the types a view
renders *well*) rather than trade it away for expressiveness.

**D2. Collections without addresses.** In TiddlyWiki a collection exists only as
markup inside some tiddler; it cannot be linked to, enumerated, or referenced.
Our card-anchored invariant (a view is `?view=foo` on a card path) is the better
choice and should hold. The open question in the issue — where a *conventional*
collection lives in URL space when there is no card to hang off — is a real gap
that TiddlyWiki offers no help with, because it never had the invariant.

**D3. One flat namespace.** Not applicable and not desirable; our paths are
load-bearing, and a directory is already a working mixed-type collection.

---
title: "Plugins: which parts of callback-box are the medium, and which are content a box could grow itself"
workstream: unattached
area: callback-box
needs: [design]
labels: [architecture, plugins, schemas]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder thinking about what belongs in core
---

Much of what ships in callback-box could be a plugin — the educational
material, various card schemas, domain-shaped features. The boxholder's
framing, worth preserving because the line it draws is not the obvious one:

> Lots of what's in callback-box could be a plugin, like the educational stuff,
> different schemas, etc. **OTOH the basic medium shouldn't be a plugin, even
> when parts are obscure** (like different listening modes, speech input and
> output features, etc).

So the axis is **not** how often something is used. Speech input and output and
the listening modes are obscure, and they stay — they are part of what a box
*is*. Educational schemas are widely applicable and could go — they are
something a box is *about*. The distinction is closer to **medium versus
content**, and naming it that way is most of the design.

And trimming is not the goal in itself: *"I don't want to trim everything; e.g.,
importing material has several types that I think should be in the core."*
Intake is medium — a box that cannot take material in is not a box.

## The idea with the most in it: a box starts with its own plugin

> A box could **START** with its own plugin, so the moment the agent wanted to
> extend the system it would self-develop a plugin(s) for the box. That then
> turns into a kind of interesting opportunity for **extracting personal work
> and making it shareable**.

This inverts the usual plugin story. Rather than plugins being things you go and
install, every box is born with an empty one, and it is simply *where extension
goes*. The agent that wants a new card type, a new view, a new procedure has an
obvious place to put it — and because that place has a shape, what it builds is
a candidate for sharing rather than a personal accretion tangled into a box.

That is the part worth designing around. It makes "how do I share this thing I
made?" a packaging question instead of an archaeology question.

## Some of this already exists, unnamed

The design should start from what is already true rather than greenfield:

- **Box-local schemas** already work — `config/schemas/` is watched and
  hot-reloaded (`src/core/schema-watcher.ts`), and box-local schemas import the
  same primitives via the public `callback-box/cards` specifier.
- **A box is already a package** with its own `package.json` and
  `node_modules`, importing only the public `callback-box/{cards,schema,view-widgets}`
  entry points — never engine internals. That boundary is exactly a plugin API,
  it just isn't called one.
- **Box-local views and procedures** already live in the box
  (`config/procedures/`, box `src/views/`).

So the extension surface exists in pieces. What is missing is a *name*, a
consistent shape across the pieces, and the idea that this is the default
destination for new work rather than an escape hatch.

## The boxholder's own framing of scope

> I think this fits into reforming the filesystem structure as well.
>
> This probably doesn't affect the each-box-is-its-own-package thing.

Both worth testing rather than assuming. The second looks right — boxes-as-
packages gives a plugin somewhere natural to live (a local module, or a real
dependency), so it is more foundation than conflict.

## What the design has to settle

- **Where the line actually falls.** The medium/content distinction is a good
  compass and a bad specification. The useful artifact is a decision *per
  subsystem*, with the reasoning — enough that the next person can place a new
  feature without re-litigating the principle.
- **What a plugin can extend.** Schemas, views, procedures, connectors,
  commands, prompts? Each is a different kind of surface, and some (prompts,
  agent guidance) have no boundary at all today.
- **Versioning and the API contract.** The moment a plugin is shareable it is
  coupled to an engine version. The public-specifier boundary is the natural
  contract; whether it is stable enough to promise is a separate question.
- **What "shareable" means concretely.** Copy a directory? An npm package? A
  git remote a box can pull from? The answer decides how much machinery this
  needs, and the cheapest version that works is worth finding first.
- **The extraction path.** Personal work becomes shareable by having the private
  parts removed. That is judgment, not mechanism — the same problem as the
  public/private issue split, which might be prior art worth reading.
- **Migration.** Moving a schema out of core changes where existing cards'
  definitions come from. `docs/migrations.md` step 7 applies: whatever moves,
  file the legacy-removal issue at the same time.

## Read: TiddlyWiki's plugin system (2026-08-19)

Reviewed against the source — [`research/tiddlywiki/plugins.md`](../../research/tiddlywiki/plugins.md).
Three findings bear on the open questions above.

**"What a plugin can extend" has a good answer: an enumerated vocabulary, at two
tiers.** TiddlyWiki names 30 module types, and the extension surface reaches all
the way down — `filteroperator` adds an operator to the query language, `widget`
adds a rendering primitive, `wikirule` adds markup syntax. The core is itself a
plugin. So the question this issue is stuck on ("does the extension surface
reach query and rendering?") has a demonstrated yes.

The more useful half is the second tier: the *same* extension points are
reachable without JavaScript. `\function my.op(...)` is callable as a filter
operator `[my.op[x]]` alongside the built-ins; `\widget $my.widget` is callable
as `<$my.widget/>` and may override a built-in widget, reaching the original
through `<$genesis>`. Loading follows the split — non-code plugins hot-load,
code-bearing plugins need a restart — which is the split we already have
(`src/core/schema-watcher.ts` hot-reloads box-local schemas). That is the shape
for "a box starts with its own plugin": the box's plugin should be authorable in
the box's own materials and reach the same extension points that code does, with
code as the escalation rather than the entry fee.

**The extraction path has a mechanism, and it is overlay rather than fork.**
Plugin constituents load as *shadow tiddlers*: any of them can be overridden by
creating an ordinary tiddler of the same title, and deleting that tiddler
restores the shipped version. Local customisation is therefore already a
separable set of records — "what has this wiki changed?" is a listing, not a
diff, and extracting personal work is packaging rather than archaeology. Our
nearest existing thing is template stock tracking
(`config/template-versions.json`), which detects divergence rather than layering
over it. Worth deciding whether a box's own plugin *shadows* engine defaults by
identity.

**One question this reopens: is a plugin a unit of content as well as code?**
The docs are explicit that plugins "can also be used to distribute ordinary
text, images or any other content", and editions ship as plugin bundles — one
packaging mechanism carrying either. That draws the medium/content line in a
different place from this issue's framing. If a callback-box plugin can ship
cards, "an education plugin" means something quite different from "a plugin that
adds education card types", and that should be decided rather than defaulted.

What does not transfer: no isolation and no dependency resolution (a `dependents`
list, a `core-version`, a numeric priority, and later-wins precedence is the
whole system). The public-specifier boundary — `callback-box/{cards,schema,view-widgets}`
— is already a stronger contract and should stay the plugin API.

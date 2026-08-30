# TiddlyWiki plugins: structure, reach, and sharing

**Written 2026-08-19**, from the TiddlyWiki5 repository at `master`
(`5.5.0-prerelease`). Context for
[plugins and the medium/content line](../../issues/exploration/2026-08-19-plugins-and-the-medium-content-line.md);
the main note is [expressing-content.md](expressing-content.md).

---

## 1. What a plugin is

> Internally, plugins are a bundle of tiddlers packaged together as a single
> tiddler that can be installed, copied, disabled or deleted as a unit. The
> individual tiddlers within a plugin appear as **shadow tiddlers**.

Structurally: a plugin is one tiddler whose `type` is `application/json` and
whose `text` field is a JSON encoding of the tiddlers it contains. Its fields
are the manifest — `title` (by convention `$:/plugins/<publisher>/<name>`),
`name`, `description`, `author`, `version` (semver), `plugin-type`,
`dependents`, `plugin-priority`, `parent-plugin`, `source`, `list` (which of its
own tiddlers are the readme/license/history), and since 5.4.0 `platform: node`
to restrict a plugin to the server.

The **shadow tiddler** mechanism is the part with the most in it:

> The tiddlers within registered plugins are ShadowTiddlers: they can be freely
> overwritten by creating a tiddler with the same title, but deleting that
> tiddler restores the underlying tiddler value from the plugin.

So local customisation is *layering*, not forking. Every constituent of every
plugin — including the core, which is itself the plugin `$:/core` — can be
overridden by creating a same-titled ordinary tiddler, and the override is
removed by deleting it. There is no fork, no patch, no merge, and the
customisation is trivially separable from the thing customised. That property is
what makes "extract personal work and make it shareable" a packaging step rather
than an archaeology step: the personal layer is already a distinct set of
tiddlers, by construction.

On the server, a plugin is a folder with a `plugin.info`:

```json
{
	"title": "$:/plugins/publisher/name",
	"name": "name",
	"description": "An exemplary plugin for demonstration purposes",
	"author": "JeremyRuston",
	"version": "1.2.3-alpha3",
	"core-version": ">=5.0.0",
	"source": "https://tiddlywiki.com/MyPlugin",
	"plugin-type": "plugin",
	"list": "readme license history"
}
```

placed under `plugins/` in the wiki folder, where "TiddlyWiki will attempt to
include every subfolder as a plugin".

`plugin-type` is `plugin`, `theme`, or `language` (plus internal `import` and
`info`). Themes and languages are plugins with a singleton rule: only the one
named in `$:/theme` / `$:/language` is active. Custom plugin types are allowed
and, notably, get their own UI by contributing a `$:/tags/ViewTemplate` segment
— a plugin can change how plugins of its own kind are displayed.

---

## 2. What a plugin can contribute — and whether it reaches query and rendering

It can contribute **any tiddler**, so the answer is "everything", but the
mechanisms fall into two clearly separated tiers, and the two-tier split is the
finding.

### Tier 1 — JavaScript modules

A JS module is a tiddler with `type: application/javascript` and a
`module-type` field. The core defines 30 module types
(`core/language/en-GB/Docs/ModuleTypes.multids`); the ones that answer our
question directly:

| module-type | What it adds |
|---|---|
| `filteroperator` | "Individual filter operator methods" — **a new operator in the query language** |
| `isfilteroperator` | a new category for `is[...]` |
| `allfilteroperator` | a new category for `all[...]` |
| `widget` | "Widgets encapsulate DOM rendering and refreshing" — **a new rendering primitive** |
| `wikirule` | "Individual parser rules for the main WikiText parser" — **new markup syntax** |
| `parser` | parsers for new content types |
| `storyview` | list-widget animation/behaviour modules |
| `macro` | JavaScript macro definitions |
| `route`, `authenticator`, `command`, `saver`, `startup`, `tiddlerdeserializer`, `upgrader`, `tiddlerfield`, `wikimethod`, `utils`, … | server routes, CLI commands, persistence, lifecycle, field semantics |

A filter operator is a plain export of the pipeline signature — this is the
entirety of the contract, from `core/modules/filters/tag.js`:

```js
exports.tag = function(source,operator,options) {
	var results = [];
	// …
	return results;
};
```

So yes: **the extension surface reaches both the query layer and the rendering
layer, and also the parser.** A plugin can add a filter operator, a widget, and
new wikitext syntax, with no privileged distinction between what the core does
and what a plugin does. `$:/core` is itself just a plugin with priority zero.

### Tier 2 — wikitext definitions, no JavaScript

This tier matters more for us, because it is the one a box's agent could write.

**Filter operators in wikitext**, via `\function` (5.3.0):

```
\function myfun(param:"2")
[<param>multiply[1.5]]
\end
```

> Directly call functions whose names contain a period as custom filter
> operators with the syntax `[my.fun[value]]` or `[.myfun[value]]`

**Widgets in wikitext**, via `\widget` (5.3.0):

```
\widget $my.widget(attribute:"Default value")
This is the widget, and the attribute is <<attribute>>.
\end
```

called as `<$my.widget attribute="The parameter"/>`, with the call site's
content available inside as `<$slot $name="ts-raw"/>`. A custom widget may even
override a built-in JavaScript widget, and reach the original through
`<$genesis>` — decoration without patching.

**Rendering rules**, via cascades: a new rule for how a thing renders is a
tiddler tagged with the cascade's tag, containing a filter expression, ordered
by `list-before` / `list-after` (see [expressing-content.md §4](expressing-content.md#4-cascades--the-type-dispatch-mechanism)).

**UI segments**, via system tags: `$:/tags/ViewTemplate`, `$:/tags/PageControls`,
`$:/tags/SideBar`, `$:/tags/Stylesheet`, ~60 documented insertion points. Adding
a tiddler with the tag adds the thing.

The loading behaviour follows the tier split exactly:

> Plugins that contain JavaScript modules require a reload of the wiki before
> they will work. Plugins that do not contain JavaScript modules are
> automatically dynamically loaded and unloaded.

---

## 3. Sharing and installation

- **Single file**: drag a link like `$:/plugins/tiddlywiki/example` onto the
  wiki window, import, save, reload. Or install from the official plugin library
  through the control panel.
- **Node.js**: a folder under `plugins/`, or a shared folder found via
  environment variables, or named on the command line.
- **Precedence**: environment-variable folders → wiki `plugins/` → command line
  → drag-and-drop, with "elements lower in the list take precedence".
- **Dependencies**: a `dependents` field listing plugin titles that must be
  installed, plus `core-version` and a numeric `plugin-priority`. That is the
  whole dependency system — no resolver, no version ranges between plugins, no
  isolation. A plugin can override any tiddler in any other plugin, including
  the core.

---

## 4. Dispositions

### Adopt

**A1. Two tiers of extension, split by whether code is required.** TiddlyWiki
lets a wikitext definition contribute to the *same* extension points a JS module
does — a `\function` with a dot in its name is callable as a filter operator
alongside the built-in ones; a `\widget` is callable alongside built-in widgets
and can override them. This is the shape our plugin issue should aim at: the
box's own plugin should be authorable in the box's own materials (a schema, a
view, a procedure, a query) without dropping to engine-level code, while the
same surface remains open to code when needed. It also matches the hot-reload
split we already have — `src/core/schema-watcher.ts` hot-reloads box-local
schemas; a code-bearing plugin would not.

**A2. Overlay, not fork, as the customisation primitive.** Shadow tiddlers make
"customise a shipped thing" and "extract my customisation" the same operation
from opposite directions. Our nearest existing instance is template stock
tracking (`config/template-versions.json`), which detects divergence rather than
layering over it. If a box starts with its own plugin, the plugin's contents
should *shadow* engine defaults by identity, so that removing the box's version
restores the shipped one — and so that "what has this box changed?" is answerable
by listing the overlay rather than diffing.

### Adapt

**B1. Extension surface enumerated as a fixed vocabulary.** 30 named module
types is a specification of what the medium is extensible in, and it is
inspectable — the ModuleType doc page renders itself with
`<$list filter="[moduletypes[]]">`. Our issue's "what a plugin can extend"
question wants exactly this artifact: an enumerated list of contribution kinds
(schema, view, collection view, procedure, connector, command, prompt), each
with a named contract. Prefer a short enumerated list to "a plugin can contain
anything".

**B2. `plugin.info` beside the code, not a registry.** A plugin folder declares
itself; nothing central lists plugins. A box is already a package with its own
`package.json`, so the manifest slot exists; a plugin manifest should live with
the plugin and be discovered by scanning, matching how `config/schemas/` already
works.

### Reject / not applicable

**C1. No isolation, no dependency resolution.** A plugin overriding arbitrary
core tiddlers is workable in a single-user single-file wiki and is not a model
to copy for something a box loads. Our public-specifier boundary
(`beebox/{cards,schema,view-widgets}`) is already a stronger contract than
anything here, and it should stay the plugin API.

**C2. Themes and languages as plugin subtypes.** A singleton-plugin-type
mechanism solves a problem we do not have.

### Notable, no disposition yet

**Plugins as the unit of *content*, not just code.** The docs are explicit that
"Plugins can also be used to distribute ordinary text, images or any other
content", and editions ship as plugin bundles. That is the medium/content line
drawn in the opposite place from our framing: TiddlyWiki has one packaging
mechanism and lets it carry either. Worth deciding deliberately rather than by
default — if a beebox plugin can ship cards as well as schemas and views,
"an education plugin" means something quite different from "a plugin that adds
education card types".

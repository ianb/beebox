---
title: "Card themes: paper, Post-it, and plain"
status: implemented
workstream: paper-cards
issues: []
---
# Card themes: paper, Post-it, and plain

When reading a document, keeping a short note, or using a functional card, the
boxholder should get a visual treatment that suits the material. This plan
introduces themes independently of views, with agent-editable selection rules,
three built-in themes, optional app chrome, and a lasting visual tour in test1.

**Issues addressed:** none directly. A search of `issues/features`,
`issues/decisions`, and `issues/exploration` for theme, Post-it, backside, and
back-of-card found no matching theme-system item. Related context:
[public-site aesthetic principles](../../../issues/features/2026-07-20-public-site.md),
[interface as cards](../plans/interface-as-cards.md),
[chat everywhere](../plans/chat-everywhere.md), and
[card prominence](../implemented-plans/card-prominence.md).
This plan does not close those workstreams or import their remaining obligations.

Implementation is authorized, including a persistent test1 tour, additional
read-only Properties, and a per-card theme picker with material swatches.
Public examples must be
new, generic material. Private reference content must not appear in source,
fixtures, documentation, review prompts, or commits.

## Stated preferences this plan trades against

Direct boxholder decisions in this workstream take priority:

- A theme system is needed alongside the view system, registered differently.
  Some card types need their own treatment; paper can become cloying.
- The originating brief requested general styling by card type or location,
  together with a specific per-card override. Location rules remain in scope;
  the proposed ordering below is an explicit design choice to review.
- Use Tailwind and custom classes to make themes straightforward to implement.
  Discover structural needs while building the built-in themes.
- Chrome treatment is optional. A theme need not implement the top bar or input.
- Start with textured paper, a Post-it-like treatment, and a bland/plain theme.
- The preferred view is normally right. Put alternate-view selection on the
  back, where it functions mainly as an inspection/debugging tool.
- Properties contents need discussion. The purpose of tucked-under cards remains
  undecided. Do not turn an appealing image into an invented relationship rule.
- Layered blockquotes should be easy to select and may differ by theme.
- Chat treatment comes later; user messages may appear laid on top.
- Leave a visual tour in test1 for future use.

The material vocabulary is tab (containing context), tag (nearby-card label),
pen (link treatment), dog-ear (the shared Properties affordance), stack (layered
cards), and stock (a coordinated material variation within a theme). These are
visual terms, not replacements for accessible button/link semantics.

Design decisions below follow [engineering principles](../engineering-principles.md)
1/3 (typed, validated selection), 4/13 (visible fallback and actual resolved
state), 7/8 (one registry and one host), 10 (pure resolution tests), and
11/12 (enforced conventions and discoverable authoring guidance).
The public-site principles support spare, personal character. They do not
require every surface to resemble stationery.

## What already exists

Paths below are relative to `beebox/`; line anchors refer to the planning checkout.

| Evidence | Reuse / change |
|---|---|
| `src/frontend/src/lib/view-bindings.ts:58-61`: `trpcClient.views.list.query()` and `if (!map.has(type)) map.set(type, ...)` | View bindings derive from authored-view metadata. Keep this mechanism independent; a theme is not another preferred renderer. |
| `src/frontend/src/file-type-registry.ts:113-117`: "Register a renderer and/or list UI"; "Multiple ... registrations ... stay live" | Follow the explicit registration precedent, but create a theme registry with its own resolution rules. |
| `src/frontend/tailwind.config.js:76`: `content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"]`; `src/frontend/package.json:59`: `"tailwindcss": "^3.4.0"` | Engine theme classes compile in the existing Tailwind 3 build. Box source files are outside this content list. |
| `src/webapp/views/compiler.ts:201`: `loader: "tsx"`; `:217`: `const outputFile = result.outputFiles[0]` | The authored-view compiler is not a theme/CSS delivery system. Do not promise arbitrary box Tailwind classes work today. |
| `src/frontend/src/components/FileView.tsx:254-259`: "Frameless: just the renderer output" and `return captured`; `:264`: `border rounded-lg overflow-hidden bg-white`; `:278-285`: companion wrapper and body | Theme ownership must account for page, chat card, companion, and frameless embed modes. Avoid extra nested shells and preserve focus/selection capture. |
| `src/frontend/src/pages/card/CardViewPage.tsx:63-64`: `<Card padding="none" shadow>` around `<FileView` | Consolidate physical card framing; changing only the renderer would leave a second outer card. Audit BrowseDetailPanel and ViewPage wrappers in the same change. |
| `src/frontend/src/components/FileView.tsx:281`: `<RendererToggle ... compact path={data.path} />` | Move card alternate-view controls into Properties while preserving explicit view URLs and selection handlers. Non-card file controls remain available. |
| `src/frontend/src/components/MarkdownCardView.tsx:95-106`: `data-card-section="frontmatter"`, `<FrontmatterFields ... />`, then `<Markdown prose="block" ...>` | The default markdown renderer currently leads with all frontmatter. Properties work must distinguish metadata from actual structured card content. Keep the real Markdown renderer. |
| `src/shared/markdoc-config.ts:147-154`: `from: { type: String }`, then `node.inline ? "QuoteInline" : "QuoteBlock"` | Extend the existing quote tag with a treatment attribute. Keep inline/block semantics. |
| `src/frontend/src/components/Quote.tsx:4`: "Distinct from a plain Markdown blockquote: a `quote` carries provenance"; `:82-86`: attribution in `figcaption` | Share appearance hooks without erasing the distinction between verbatim quotations and ordinary blockquotes. |
| `src/core/body-markdoc-lint.ts:4-11`: every markdown body is validated; findings "surface as warnings, not errors" | Extend existing validation and name its actual severity. Do not claim all malformed quote attributes block commits. |
| `src/frontend/src/components/view-widgets/CardLink.tsx:39-40`: "A real href ... middle-click / open-in-new-tab work"; `:68`: hardcoded underline classes | Replace appearance through a shared link role; preserve destination, modifier-click, missing-ref, and host behavior. |
| `src/core/find-inbound-card-refs.ts:5-7`: uses the rewrite scanner so resolution is "identical to `bbx mv`"; `src/webapp/trpc/routers/card.ts:188-192`: `inboundRefs` returns `referrers` | Backlinks have an on-demand scanning API, not a proven cheap per-card live index. Reuse on Properties open, with explicit loading/error states. |
| `src/cards/schema.ts:97-103`: `GLOBAL_CARD_FIELDS` includes `prominence`; `:108-115`: schema validation has "no ... box / cross-card access" | Add an optional global presentation choice; catalog membership needs host-side validation, not a hidden box read from Zod. |
| `src/core/box/config.ts:4`: "Reads _config/box.json ... Caches results"; `:17-75`: `BoxConfig` | Add validated presentation configuration to the existing box config. Do not refactor unrelated configuration. |
| `src/shared/prominence.ts:5-6`: "This is not access: every card ... is readable and addressable"; `src/schemas/landmark.ts:219`: "A landmark card is a place marker, not a visitable file" | Stock never changes discoverability. Tabs must not blindly navigate to landmark files. |
| `docs/tours.md`, Running/Artifacts: `bin/tour`; tours "are still not a test gate" | Reuse the scripted browser tour framework, plus an actual persistent card gallery in test1. Behavioral assertions belong in doctests. |

## Prior art (external)

- [Tailwind 3 content configuration](https://v3.tailwindcss.com/docs/content-configuration):
  classes must exist as complete source tokens in scanned files. Use literal
  class maps and CSS variables; do not construct color utility names from stock
  strings. This also bounds the first version's authoring support.
- [Tailwind 3 CSS preprocessing](https://v3.tailwindcss.com/docs/using-with-preprocessors):
  use the existing PostCSS/Tailwind pipeline for custom component classes and
  `@apply`; no framework upgrade is necessary for the three built-ins.
- [Markdoc validation](https://markdoc.dev/docs/validation): attributes and
  custom validation support a small named quote-treatment vocabulary. Rendering
  and validation remain separate obligations in Bee Box's existing pipeline.

These are mechanism references, not visual templates. New design work uses the
three themes and the existing app's actual content density as its comparison.

## Tracks / scope

### A. Visual contract and persistent test1 tour

**What / why:** Establish the three distinct treatments on representative cards
before locking shared markup. A note-only mockup cannot settle dense views,
forms, small screens, or optional chrome.

**Direction:** Build a persistent `_content/theme-tour/` area in the worktree's
isolated test1 box during implementation. It contains an entry-point card,
ordinary memo examples, a short note, a structured/functional example, a long
document with tables/code/images, and quotation examples. Use new fictional
content. Show the same content under paper, Post-it, and plain, then mixed themes.
The gallery must use the real preferred views and theme host once available;
early illustrative compositions are clearly labeled until replaced.

Keep a tracked generic seed fixture and an idempotent installer under the existing
test-support conventions. The installer creates only its owned tour paths and
reports edited-file conflicts instead of overwriting them. Seed source survives
worktree removal; the installed tour stays in test1. Install to the worktree clone
now and carry the seed into the shared test1 during an explicitly authorized
landing, rather than modifying a sibling box in this session. No production-box
seeding. Publish useful captures as a labeled exhibit.

Review these checkpoints: three-theme comparison; narrow/long content; quote
variants and attribution; mixed nested cards; optional chrome; Properties content;
tabs and a clearly labeled stack experiment. The stack experiment has explicit
sample inputs and makes no claim about automatic relatedness.

**Vocabulary lock-ins:** `plain`, `paper`, `post-it` are proposed built-in IDs;
the display name of `post-it` may be “Sticky note.” Tour path and names are stable.

**First implementation chunk:** Add the generic tour content, installer, and
baseline browser walk using the current renderers. No theme schema or production
UI changes in this chunk. Present candidate Properties/tab/stack compositions
before their dependent product choices are implemented.

### B. Theme registration and deterministic selection

**What / why:** Support a box containing visually different kinds of cards without
changing which view opens or making every theme implement the app shell.

**Direction:** Add shared catalog metadata under `src/shared/` and frontend
implementations under `src/frontend/src/themes/`. A theme descriptor declares
its ID, label, stock names/default, quote/block-quote defaults, and optional
chrome capability. Frontend registration supplies literal role classes and
only the small structural slots proven necessary by A/C. Shared metadata is the
single server/client/agent vocabulary; it imports no React or CSS.

Initial registration is explicit engine code, separate from view discovery.
Ship three built-ins. Adding a fourth requires a descriptor, stylesheet/class
map, and the explicit registry entry, not edits to every view. Box agents can
select themes and stocks through data. Loading new box-authored theme code/CSS
is deferred; the current view compiler cannot provide that accidentally. This
boundary is a proposed scope choice for the boxholder to review.

Initial stock catalog for visual review: plain has `neutral`; paper has
`cream`, `manila`, and `blue`; Post-it has `yellow`, `rose`, and `mint`.
The first stock listed is the default. Exact colors, grain, and edge treatments
are visual choices in A/C, not fixed hex values in card data.

Proposed persisted shapes (all optional additions):

```yaml
# A card's frontmatter
theme:
  name: paper
  stock: cream
```

```json
{
  "presentation": {
    "default": { "name": "plain" },
    "cardTypes": { "memo": { "name": "paper", "stock": "cream" } },
    "rules": [
      { "match": "_content/notes/**", "theme": { "name": "post-it" } }
    ],
    "chrome": { "name": "paper" }
  }
}
```

Add a `theme` default option to `cardSchema` (metadata, like its prominence
default), so a box-local or built-in type can prefer a treatment. It is a
preference, not a locked constraint: a user can explicitly select plain.
For a new custom visual treatment, the initial implementation still requires
engine registration; a type preference alone does not register code.
Exclude the new global `theme` field from the default renderer's frontmatter
table when adding it. Its human presentation belongs in the minimal Properties
back, not as raw configuration above the card body. Do not hide other fields.

Resolve the first complete choice in this order:

1. Card's explicit `theme`.
2. First matching box path rule, in written order.
3. Box `presentation.cardTypes[type]`.
4. Card schema's theme default.
5. Box `presentation.default`.
6. Engine `plain`.

A deliberate location rule can therefore override a functional type's plain
preference. Demonstrate this exact collision in the tour and review the ordering
before B. If type protection is preferred, move both type layers above rules;
do not add a second specificity engine or silently make schema defaults locked.

Each choice is atomic. Omitted stock means the selected theme's default stock;
it never inherits a stock from a lower-priority theme. To pick a stock on one
card, name its theme too. Return the effective choice and origin (card, rule
index, type override, schema, box default, engine) for Properties and diagnostics.
Use a single pure resolver fed already loaded data; no per-render filesystem IO.

Pattern semantics: box-relative slash paths, `*` within a segment and `**`
across segments, including zero segments for `**/`. Reject absolute paths,
parent traversal and unsupported syntax; use one shared tested matcher. No
ad-hoc reference resolution and no filesystem glob expansion merely to compare
one card path. Validate pattern syntax and theme/stock membership at load/lint.

An absent config is normal. A malformed explicit choice is not absence:
validation names the field and available choices. Runtime uses plain with a
visible presentation problem and preserves the requested value for diagnosis;
do not silently proceed down the cascade. Invalid rule/config structure makes
the presentation config invalid as a unit. Other box settings still load.
Do not broaden the existing config loader's validation or fallback behavior.
Its current `loadBoxConfig` returns `{}` after parse/read failures
(`src/core/box/config.ts:267-285`), so a consumer of that value alone cannot
implement this distinction. Factor its existing read/cache into a typed result
that distinguishes absent, valid object, and read/parse failure. Keep the legacy
`loadBoxConfig` wrapper's behavior for current callers; the presentation reader
uses the result and validates only the `presentation` subtree. This is one
shared file read, not a second config store. Tests cover invalid JSON as well as
valid JSON with invalid presentation data, and recovery after either edit.

Expose catalog/config/type metadata through a small tRPC presentation procedure;
reuse normal query caching and box-event invalidation. Theme data has a loading
state, not an unexplained flash of paper/plain. Box config and schema changes
must invalidate it; test an edit while a card is open. Query/cache identity is
box-scoped. No new daemon, persistence store, or background index.

Chrome is independently box-selected. With no explicit chrome selection, use
the box default theme's chrome if supplied, otherwise base/plain chrome. A
card's selection never changes chrome. An explicitly selected theme without a
chrome capability is a configuration error with visible base-chrome fallback.

**Vocabulary lock-ins:** `theme: {name, stock?}`, `presentation`, `cardTypes`,
ordered `rules`, `chrome`; theme and view remain different selectors. Stock
is a coordinated paper/background, ink, pen, texture, and edge variation, not
free-form CSS in frontmatter.

**First implementation chunk:** Shared catalog/choice schemas, resolver and
precedence/invalid-input doctests. It follows the visual review in A and does
not wait on Properties contents or stack semantics.

### C. Shared host, three themes, links, and optional chrome

**What / why:** Make themes work across actual card surfaces rather than putting
a second decorated box around each existing white panel.

**Direction:** Introduce one themed card presentation owner in the FileView
flow; normalize card-specific wrappers in CardViewPage, BrowseDetailPanel,
and companion/chat card hosts. Do not globally redefine the generic UI `Card`
primitive, since many of its callers are layout panels rather than content cards.

Theme role hooks cover surface/front/back, heading/body, link, quote, context
tab, tag, and Properties affordance. Layout remains component-owned. Use scoped
CSS variables for material values, complete literal Tailwind classes, and custom
component classes for texture/pen strokes. Do not weaken lint rules. Structural
slots carry presentation only; themes cannot own navigation, mutation, data
fetching, input services, or conversation selection.

Every independently surfaced card resets its material variables. Role styling must use the
nearest theme scope; a paper parent's descendant selectors must not recolor a
plain child. Portaled card controls inherit their owning card's theme explicitly;
global menus use chrome. Authored views get host variables and documented role
classes, but their explicit hardcoded CSS is not magically rewritten. Verify a
theme-aware authored view and a self-styled view with a plain type preference.

| Surface | Policy |
|---|---|
| Full card page / Browse detail / companion | One physical shell and one Properties affordance; preserve each surface's scrolling and focused-card reporting. |
| Card shown in chat | Theme that card, keep its bounded preview behavior; this does not theme message bubbles or transcript layers. |
| Frameless inline/media embed | Inherit the enclosing theme; do not independently resolve the embedded subject's theme. No new shell, tabs, back, or padding. With no enclosing theme, use plain context. A separately surfaced nested card does resolve its own theme. |
| Compact card links / list items | Small theme-aware label/mark only; do not turn every row into a full raised document. |
| Non-card PDF/image/source file | Preserve its viewer controls and media layout; card Properties applies only when there is a card subject. |

Paper has visible but quiet texture, raised edges, pen links, and a dog-ear.
Post-it is flatter, brighter, and economical; it must also handle long text
without fixed heights or clipped content. Plain provides neutral surfaces for
dense tools. All three remain legible and useful without animation or hover.
Stock colors must not substitute for semantic status/error colors.

Route prose links, Markdown card links, attribution/source links, and CardLink
through the same visual link role when inside a themed surface. Keep real hrefs,
modified-click handling, missing-ref indicators, and existing host navigation.
Preserve deliberate inline source citations and quote attribution on the front.

Implement base/plain chrome and paper chrome for the top bar, web composer and
surrounding surface. Post-it intentionally has no chrome implementation, proving
the optional contract. Base/plain chrome is today's shell appearance, preserved
without visual change; its optional interface does not restyle unconfigured
boxes on landing. Paper chrome is the new opt-in treatment. Reuse the chat-everywhere shell and the existing composer
instance. Do not remount recording/draft ownership when appearance changes.
Native iOS composer theming is deferred; show that mixed boundary honestly in
the mobile acceptance record rather than claiming full native theme parity.

**Vocabulary lock-ins:** semantic role hooks and the small structural slots
identified by the three implementations; no unrestricted component replacement API.

**First implementation chunk:** Plain theme plus shared FileView host and one
normalized page/companion path, with a nested-scope regression. Then add paper
and Post-it, complete all listed hosts and chrome, and replace A's illustrations
with real-engine tour cards before calling this track complete. Include the
minimal Properties face from D so every theme demonstrates access to alternate
views without waiting for the broader metadata-inventory decision.

### D. Quote treatments and Properties

**What / why:** Support layered quotations without rewriting content; make
presentation/debugging and provenance available without leading every card
with a metadata table and view picker.

**Direction — quotes:** Add `treatment="layered|inset|plain"` to the existing
`quote` tag. Omission uses the theme's default. All three treatment requests
have a defined rendering in every theme; the theme controls their visual
expression. Layering may be very restrained in plain. Example:

```markdoc
{% quote from="A participant" treatment="layered" %}
Keep the example near the thing it explains.
{% /quote %}
```

Attribution remains in the same figure as the quotation. Preserve selection,
copying, links, source locations, and quote extraction. Inline quotes retain
inline layout: block-only treatment attributes on inline quotes receive a
localized lint warning and render inline with a visible diagnostic in authoring
validation, never block markup inside a sentence. Invalid values likewise warn
through existing body validation and render with the theme default.

Ordinary Markdown blockquotes use the theme's separate blockquote default.
They may be layered too, but do not acquire verbatim/provenance semantics.
First version per-block selection uses the explicit quote tag for actual
quotations; do not invent a second Markdoc wrapper merely to style asides.

**Direction — Properties:** Introduce a shared Properties face for full card
surfaces. Every theme uses the same corner-turn geometry with an
accessible Properties name. Alternate views and “Use preferred
view” live here; existing explicit view URLs still work and are not rewritten
as card defaults. A separate Properties route/state must not overwrite authored
view state. Keep open/closed locally per mounted card; reload returns to front,
and an explicit alternate-view URL still selects its renderer.

The first Properties face contains alternate views, “Use preferred view,” and
the resolved theme/stock with its origin. It ships with C's host development;
the broader inventory review does not block this already requested capability.

Candidate inventory for the visual decision: title/type; filing location and
created/modified/source facts when available; resolved theme/stock and why;
prominence as a property; mentions; alternate views; existing source/edit/trash
actions under their current permissions and confirmations. Unknown facts stay
absent. No inference that a nonempty source field means spoken content.

The boxholder approved this additional read-only inventory during implementation.
Use the memo, structured card and functional view examples to verify it. Do not hide arbitrary schema fields: a recipe's
ingredients or a task's state may be its main content. Start with the existing
front intact; move only reviewed metadata out of the default renderer. No generic
property editor or automatic wholesale metadata relocation. The authorized
appearance picker is the narrow exception: owner-only `card.setTheme` saves a
validated theme/stock choice while preserving other YAML and card content.
Swatches render real materials, show the effective selection, and offer
“Use default” to remove the override. Saving and failure states stay visible.

Open Properties without destroying the front renderer's state. Hidden front
content is noninteractive and excluded from accessibility traversal; return
restores focus/scroll. Backlinks load on demand; no count in the closed dog-ear
until known. Distinguish loading, no mentions, and failed/partial lookup. The
scanner currently catches and logs unreadable referrers while returning the
remaining array (`src/core/find-inbound-card-refs.ts:132-136`). Extend its shared
scan result to carry failures, and expose them additively alongside `referrers`
in the existing tRPC response. Update scanner call sites, retaining current
trash-confirmation behavior; no duplicate scanner or deletion-policy change.
Properties labels partial results and offers Retry. Refresh on relevant file changes while
Properties is open, coalescing events; do not run a scan for every mounted card.

Context tabs get a visual experiment, not a new `up` field in this plan. Review
place navigation separately from visiting an entry-point card: only explicit
place selection changes conversational focus. Implement existing meaningful
context navigation after that review; defer new conceptual containment data.
Tucked stacks remain tour experiments until their meaning is chosen. Do not
relabel all backlinks, prominence levels, or todo `see-also` refs as “related.”

**Vocabulary lock-ins:** `treatment`, the three named quote treatments,
Properties as the shared action; the dog-ear control has consistent geometry
with theme-specific material.

**First implementation chunk:** Quote schema/renderer hooks and tests across
the three themes. The minimal Properties face is implemented with C; additional
Properties content and relocation of existing frontmatter follow the explicit
visual/content decision in A, not the candidate inventory alone.

### E. Agent authoring guidance and durable verification

**What / why:** Agents need to choose restrained defaults, understand precedence,
and discover supported names instead of inventing theme fields or CSS utilities.

**Direction:** Generate catalog reference from shared metadata. Add a short
agent-guide pointer and a task-specific theme reference to the shipped box docs;
update global-field/schema docs and type instructions where relevant. Use
`bbx-context` placement guidance. Explain view versus theme, stock versus theme,
general rules versus override, and verbatim quote versus ordinary blockquote.
Show one correct example of each and explain how to inspect effective choice.
Extend validation to show available names and the failing card/config location.
Run knowledge audits against the isolated test1 clone.

Add `test/tours/card-themes.tour.ts` using the existing browser tour library.
It walks the permanent gallery and captures both normal and narrow viewports.
Record a clearly named link to the gallery on its entry-point card and return
the running worktree URL in the implementation handoff. Keep the seed and tour
in source control; captures go through exhibits, not into fixtures.

**Vocabulary lock-ins:** generated catalog names are the authority; agent
guidance links to that catalog rather than maintaining a second stock list.

**First implementation chunk:** Catalog reference and authoring examples with
the first audit cases, followed by a run once the implemented engine is installed
in test1. No claim that plan text alone proves agent knowledge.

## Could this be simpler?

The smallest version is a CSS class on the current card page and three color
palettes. It fails the user's mixed-card-type requirement, optional chrome,
quote treatment, and alternate-view/Properties behavior. It also leaves several
white shells around the paper (principles 7/8).

The proposed first version is deliberately smaller than a theme plugin platform:
explicit built-in registration, shared role classes, a pure choice resolver,
and agent-editable selection data. No runtime CSS compiler, arbitrary React
theme modules, inheritance graph, theme marketplace, or rule daemon. A future
box-authored theme loader can consume the established descriptor contract once
the three built-ins have tested it. If box-local theme implementation is required
in the initial release, that is a scope decision before B, not an accidental
extension of the TSX view compiler.

## Subplans

None initially. Visual review is a bounded implementation checkpoint in A,
not a second architecture plan. Box-local CSS/code authoring would require a
subplan for compilation, delivery, invalidation and authoring verification if
the boxholder adds it to the initial release.

## Failure modes

Tests and handling below are planned unless explicitly marked existing.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A broad rule wins over a type preference unexpectedly | New pure resolver doctest | B written precedence and Properties origin | Inspectable, not guessed |
| A paper stock leaks into a Post-it override | New resolver case | B atomic theme choice | Prevented |
| Unknown theme, stock, or malformed pattern is hand-edited | New config/card lint cases | B named error and visible plain fallback | Visible |
| Box switch or config edit leaves a stale theme | New query/invalidation test | B box identity and event refresh | Loading/error states required |
| New theme Tailwind class is absent in production build | New build/render check with distinct literal utility | C engine-scanned sources only | Tour verifies actual CSS |
| Paper ancestor styles a plain nested card or portal | New render isolation case | C scope reset and owning context | Mixed-theme tour |
| Outer Browse or companion frame creates double cards | Existing host paths, new render checks | C one-shell ownership | Screenshot comparison |
| Alternate view or Properties loses interactive view state | New lifecycle test with local state | D stable front mount, focus restoration | Interactive tour |
| Moving frontmatter hides a card's actual content | New structured-card regression | A/D review metadata before moving | Human content review |
| Quote variant drops attribution or corrupts inline markup | Extend Markdoc/render/selection tests | D preserves semantics; warns on misuse | Visible lint |
| Backlinks fail mid-scan and say no mentions | New reader failure test | D incomplete/error result, retry | Never an empty-success claim |
| A tab silently retargets the conversation | Extend navigation-intent test | D distinguish place selection from card visit | Tour checks destination |
| Chrome changes remount composer or erase draft | Existing lifecycle coverage plus focused theme-change case | C presentation-only chrome | Draft and mount identity checked |
| Tour seeding overwrites a maintained example | New installer conflict test | A owned files, no clobber on drift | Explicit conflict report |
| Paper decoration clips text or intercepts taps | Tour and keyboard/selection walk | C noninteractive decoration, responsive sizing | Visual/manual check |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong field:** B/E distinguish preferred view from theme and
  keep stock inside a named theme choice. Metadata validation rejects bad shapes.
- **ADDRESSED — stale reference:** D reuses canonical reference scanning and
  CardLink behavior; moved/missing card links remain visibly unresolved. Theme
  IDs are catalog names, not card refs, and do not join ref rewriting.
- **ADDRESSED — simultaneous edits:** no new write path; theme selection is a
  normal card/config edit. B refreshes from current loaded data. A seed installer
  refuses to overwrite changed examples.
- **ADDRESSED — hand-edit drift / fabricated values:** B catalog validation names
  the value and choices; no arbitrary CSS or unvalidated class strings in data.
- **ADDRESSED — validation UX:** B config/card errors name location and origin;
  D Markdoc diagnostics retain the existing warning severity and body line.
- **ADDRESSED — partial rollout:** optional data defaults to plain on the new
  engine. Enable authored fields/config only after the new engine is installed.
  Existing old clients do not gain theming; no claim of old-client parity.
- **DEFERRED — stacked relationships:** no production selection policy until
  its meaning is decided. A provides a labeled experiment only.
- **DEFERRED — ordinary aside per-block variant:** ordinary blockquotes inherit
  a theme default; individual quote selection uses the existing quote tag for
  genuine quotations. A new aside syntax is a separate vocabulary decision.

## NOT in scope

- Chat transcript/message layering. Keep the future direction, but this release
  themes cards inside chat and web chrome only.
- Native iOS composer appearance or a new mobile bridge protocol. Verify the
  mixed native/web boundary; do not turn this into an input-lifecycle project.
- Arbitrary tiled window management, drag/drop stacks, or persisted arrangements.
- A production algorithm/field for tucked related cards, new conceptual `up`
  references, or promotion of backlinks into editorial associations.
- Box-authored theme code/CSS loading in the initial proposal. Selection is
  box-authored; implementations are engine-registered until explicitly expanded.
- A theme designer/settings editor, marketplace, inheritance language, or
  arbitrary user CSS editor. The agent edits validated data.
- Universal frontmatter hiding or generic Properties editing. Structured card
  content remains the view's responsibility.
- Public-site redesign, private-content fixtures, automatic production restyling,
  and a Tailwind major-version migration.

## Open design questions

These are review choices, not permission to fill gaps during implementation.

1. **Initial authoring boundary:** accept built-ins plus box-authored selection,
   or require new box-local theme implementations in this release? Lean toward
   the bounded registry above while the built-ins establish the structural API.
   Settle before B begins.
2. **Properties inventory:** compare the proposed contents on three real card
   shapes. Lean toward generic provenance/presentation facts on the back,
   domain data on the front. Settle before moving metadata in D.
3. **Top tabs:** place navigation, visitable overview, or both with distinct
   actions? Lean toward clear existing destinations and no new containment data.
   Settle the action before adding production tabs.
4. **Tucked cards:** what relationship is useful enough to deserve the spatial
   claim? No lean on the data source yet; preserve the experiment without making
   it a completion dependency for the theme system.
5. **Default appearance:** lean toward plain for unconfigured boxes, with paper
   and Post-it demonstrated and intentionally selected. The three-theme visual
   review can choose a different new-box default without migrating existing boxes.

## Knowledge audits

Add `knows_directly` cases under a `card-themes` tag in
`src/dev/knowledge-audits.yaml` and run them with the installed test1 engine:

- Choose a theme for all notes in a location, then override one card; expect
  ordered rules plus the atomic card choice, no custom schema/view rewrite.
- A card type prefers plain while the box defaults to paper; explain effective
  choice and how a deliberate box rule overrides it.
- Select a layered verbatim quote and retain attribution; do not convert a
  paraphrase into a provenance-bearing quote for appearance alone.
- An unknown stock is requested; use the catalog/validation route rather than
  inventing a class or claiming arbitrary Tailwind is available in a box view.
- Explain why selecting a card theme does not switch app chrome or conversation.

Record run results and actual read counts. Tests are not claimed run in this plan.

## What will hold this after it ships

Pure resolver/schema doctests cover cascade, atomic choices, pattern semantics,
catalog validation and default origins. Focused integration tests cover box
refresh, shared card host state, Markdoc treatment/selection preservation,
backlink failure reporting, and tour installer conflict handling. Reuse existing
tiers from [testing](../testing.md); no new testing framework.

The permanent gallery is both a reference for theme authors and the subject of
`card-themes.tour.ts`. It shows actual engine rendering, not a parallel handwritten
renderer. Run the tour, inspect screenshots, and package labeled evidence in an
exhibit. Check contrast independently because [tours](../tours.md) documents that
its current axe run suppresses color contrast. Verify keyboard focus, touch-sized
Properties controls, reduced motion, print, long content, and nested scopes.

## Implementation order

1. A: persistent generic gallery seed and baseline tour; visual compositions and
   decisions on initial authoring scope, Properties and tab behavior.
2. B: catalog/schema/resolver tests, then config/card/type wiring, diagnostics,
   delivery and invalidation. No unresolved authoring question in this chunk.
3. C: shared host with plain and minimal Properties, then paper/Post-it; normalize all card frames,
   shared link roles, and optional web chrome. Replace illustrative tour content
   with real theme selections as each surface exists.
4. D: quote treatments and preservation tests; expand Properties only after
its content review. Tabs only after action review. Keep stack experimental.
5. E: generated reference, guidance/audits, durable tour completion.
6. Run bounded affected checks and visual/mobile acceptance; cross-model review
   implementation, resolve material findings, and present the finished tour.

These are commit boundaries, not partial shipping boundaries. Merge/deploy only
when requested after the whole agreed plan is complete.

## Rollout shape

The plan and its [engineering review](card-themes.review.md) record the initial
design. Implementation and verification results are recorded below.

During implementation, write the decision tests before each substantial path;
run affected doctests, frontend/backend typechecks, changed-file lint, doc checks,
and the knowledge audits. A production frontend build must include all three
theme styles. Run the persistent tour at desktop and mobile widths and inspect
its results. Check card switching with an unsent draft and quote selection;
verify actual mobile web behavior. Native physical-device checks are required
only for claims about native usability and remain separately reported.

Optional new metadata/config is additive and needs no card migration. Do not
bulk rewrite existing cards or set paper across production boxes. Document
rollback: old engines may not understand or preserve newly authored theme
fields, so avoid editing such cards with an older engine; remove only explicit
theme choices/config if a downgrade is required. Existing unmodified cards
remain valid. The tour installer is repeatable and isolated from production.

Done means all three themes, the agreed Properties behavior, quote variants,
optional web chrome, validated selection and agent guidance work together; the
real test1 gallery remains accessible; and verification boundaries are recorded.
Open stack semantics and future chat layers do not get silently promoted into
either implementation requirements or claimed delivered behavior.

## Implementation and verification

Implemented the shared theme catalog and resolver, box/type/card selection,
owner-only swatch editing, scoped card materials, optional chrome, Properties,
quote treatments, and the persistent generic gallery. The catalog drives quote
shape defaults; material CSS supplies stocks. Properties includes read-only
facts and on-demand mentions. Preferred-view reset clears the owning URL or
view target, including the `/views/` route.

Stack/context-tab semantics remain a labeled composition study. Production
association behavior, box-authored runtime CSS, and chat-message layering are
outside this implementation. Native composer pixels are unchanged.

Verification on this branch:

- The affected 423-file test selection ran 5,703 assertions. Its only three
  failures were old global-field lists; the corrected three doctests then
  passed all 45 assertions. Focused resolver, route, validation, quote, scan,
  and installer checks cover the subsequent review fixes.
- The final focused seven-file selection passed all 58 assertions. All four
  theme knowledge audits pass, including an isolated authoring exercise that
  created a location rule and a per-card exception. Focused card validation
  passed; full validation of that cloned test box also reported its unrelated
  existing path/reference errors.
- Backend/frontend/tooling typechecks, changed-file lint, doc checks, and the
  production frontend build pass. Vite still reports the existing large-bundle
  warning; no bundle threshold was changed.
- The persistent `card-themes` tour completed 13 checkpoints at desktop and
  mobile widths, with zero findings and zero axe violations.
- Manual browser probes verified retained front DOM during swatch saves,
  an unchanged unsent draft, lazy Properties, inherited frameless embeds,
  independently reset swatch materials, 44-pixel Properties controls, narrow
  table/image layout, reduced-motion links, optional paper chrome, and print
  rendering the card front while Properties is open. Print omits card
  decorations and the composer.
- Numeric contrast checks pass AA for ink, muted ink, and pen on every stock;
  the lowest muted-ink contrast is 4.96:1. Paper chrome is 6.62:1.
- Cross-model implementation findings and their disposition are recorded in
  the companion review. This branch has not been merged or deployed.

Recreate the gallery from the monorepo root with
`node --import tsx beebox/scripts/install-theme-tour.ts <box-root>`; it refuses
to overwrite changed files. Run `bin/tour card-themes` for the browser walk.
The entry card is `_content/theme-tour/Theme_Tour.memo.card`.

### Visual correction: complete card previews

The initial gallery verified direct card pages but missed the actual link-open
preview: a second title bar and an edge-to-edge card made the result read as a
colored panel. Card previews now rest at their natural height on an inset desk,
with their own heading and a separate close control. Long cards scroll within
the desk; mobile retains space around the sheet. Non-card previews retain their
existing frame. Paper has fine grain, faint pulp, an edge vignette and raised
shadows; sticky notes have fibers and a subtly lifted lower edge. The persistent
`bin/tour card-theme-previews` walk covers this link-open path for all three
themes and long content.

The preview tour passed all four checkpoints at desktop/mobile widths with zero
findings and zero axe violations. Manual mobile checks reached the bottom of a
long card while the close control stayed visible; Escape dismissed the preview,
and the page retained its viewport width. Frontend/tooling typechecks, changed
lint, documentation checks, and the production build passed.
Muted ink and pen were darkened to account for the texture and edge vignette;
under a conservative edge-background model, paper muted ink is at least 5.10:1
and pen at least 4.70:1. Plain previews use a neutral surround; the warm desk
follows paper or sticky-note cards. The follow-up review is recorded alongside
the original implementation review.

### Quote slips and normalized comparisons

Paper and Sticky note now default both ordinary blockquotes and attributed
quote blocks to layered slips. Each slip has its own faint fibers, edge and
shadow, with a small angle on the background only; words remain selectable in
normal flow and attribution remains inside the figure. Plain defaults stay
flat. Explicit inset/plain treatments suppress the slip, and explicit layered
remains available in Plain. Print suppresses the slip decorations.

All four comparison cards now contain byte-identical bodies: a studio note,
link, list, ordinary blockquote and attributed quote. The separate treatment
study repeats identical words and attribution for all four choices. The stack
composition study remains available. The preview tour also checks that both
quote forms follow the theme.

Verification: the updated four-checkpoint preview tour passes at desktop and
mobile widths with no findings or axe violations. All 34 focused quote/catalog
assertions pass, as do lint, tooling typecheck, documentation checks and the
frontend build. Browser checks confirm default/layered slips and inset/plain
opt-outs. The comparison exhibit offers identical-content side-by-side images
and individual inspection; test1 retains the live cards with existing theme
overrides preserved.

### Shared corners and page-turn control

Card surfaces and quote slips now share a theme-owned corner-radius token.
Physical quote slips extend about six pixels past the card's right edge in
roomy views; only the decoration overhangs. Nested quotes and compact scrolling
chat cards keep their decorations inside their container. Properties uses the
same 44-pixel corner-turn control across all themes, with consistent
accessible labels and focus behavior; themes vary the material, not the control.

The preview tour passed all four checkpoints at both widths with no findings
or axe violations, including the shared control check. Manual checks found no
horizontal scrolling at 390 pixels and confirmed focus stays on the control
when turning over. Typechecks, focused lint, documentation checks and the
frontend build passed.

### Fold animation and fibrous stock

The shared fold now has no arrow. Clicking turns the card in two short stages
(320 ms total), swapping to Properties at the midpoint. Keyboard focus and the
mounted front view survive the turn; reduced motion switches faces immediately.
Manila paper adds irregular short fibers to its grain, echoed more softly on
quote slips. Other stocks retain their existing finishes. A matching-content
manila example remains in the test1 gallery. The expanded preview tour passed
five checkpoints with no findings or axe violations.

### Full-interface framing and card tabs

Companion cards and Browse details now rest on a padded desk (20 pixels on
roomy layouts, 12 on narrow ones), retaining their natural sheet height. Browse
keeps the path and full-view action outside the card without duplicating its
heading. Raw file views retain their previous container structure.

Open-card tabs share one shape, while their paper,
ink, font and subtle grain follow the card's theme. The existing batched file
summaries now include type and an authored theme choice, so tabs use the same
box/schema/card cascade as the full surface without loading card bodies. An
invalid explicit choice stays an explicit plain fallback. Existing realtime
summary invalidation and the shared presentation provider update tab material
when the card or box rules change.

A focused cross-model review caught asynchronous desk classification and a
Browse shadow-clipping rule; both were corrected. The interface tour checks
Browse at desktop and phone widths, including visible gutters and no horizontal
overflow. It passes with zero findings and zero axe violations. Live companion
checks also confirmed that selecting a stock in Properties updates its tab and
that narrow desktop layouts retain their gutters. The metadata and consumer
checks passed 36 assertions, with frontend/backend/tooling typechecks and lint.

The companion tab row now sits on the same desk inset as its card, with no
gutter between the selected tab and the sheet. The selected tab rises slightly
above inactive tabs and joins the card edge without an underline. When the
leftmost tab is active, the sheet corner squares off at that joint. The outer
gutter surrounds the combined tab and card.

Active tabs now reuse the actual stock texture layer, including manila fibers.
Attached cards retain their full vignette and raised shadow. Tab and sheet
sample one material canvas, with geometry refreshed on resize, tab scrolling,
and Properties turns; the bright top rim breaks only at the tab joint. Frontmatter grids
use shrinkable value columns and overflow-wrap:anywhere; reference labels use
the shared display-path formatter without changing navigation targets. Actual
nested reference fields were checked at desktop, narrow desktop, and phone
widths with no horizontal overflow.

A focused cross-model review of the shared material geometry confirmed the
coordinate math and turn-animation guard. It raised two transition concerns:
a themed tab temporarily uses its own material bounds before its card loads,
and mobile keyboard changes may emit only a visual-viewport event. Neither
requires another listener or retained stale geometry: there is no sheet to
align during loading, mounting triggers measurement, and ResizeObserver tracks
actual pane, tab, and card size changes. Browser checks covered tab scrolling,
Properties height changes, and a narrow desktop resize; physical-device keyboard
behavior was not checked. Frontend typechecking, changed-file lint, documentation
checks, and diff whitespace checks pass.

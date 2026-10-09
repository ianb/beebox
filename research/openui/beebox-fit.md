# Would Bee Box gain from OpenUI? (2026-10-08)

Reads the three evidence notes ([hands-on](hands-on.md),
[project and governance](project-and-governance.md),
[alternatives](alternatives.md)) against the
[inventory of Bee Box's agent UI surfaces](beebox-surfaces.md). The
[README](README.md) carries the disposition table; this note is the reasoning.

## 1. What OpenUI is, in one paragraph

A line-oriented DSL (`name = Component(positional, args, [refs])`), a
hand-written TypeScript parser that autocloses the pending line and
re-materializes the tree on every chunk, a Zod-described component catalog
that reaches the model only as text in the system prompt (9,125 tokens for
the default 82-component React library), and a validator that drops or
defaults invalid nodes and reports structured errors. Single vendor (Thesys,
seed stage), all packages 0.x, weekly releases with renamed props, MIT, a
hosted "Gateway/Autofix" paid tier that the CLI and docs steer toward, and a
`postinstall` telemetry script that pnpm blocks by default. The "open
standard" is two prose pages inside the implementation repo; the "67% fewer
tokens" is one scenario against pretty-printed JSON, and 12 to 42% against
minified JSON ([hands-on §5](hands-on.md#5-tokens-and-latency)).

## 2. The three places it could apply

### Custom views (agent-authored React)

Bee Box views are real code compiled by esbuild and dynamic-imported
same-origin (`beebox/src/webapp/views/compiler/compile.ts`,
`AgentViewRenderer.tsx`). The trade-off is deliberate: unbounded
expressiveness and durability, with the box agent as trusted author. OpenUI
would replace that with an 82-component catalog that has no map, no
free-form layout, no file access, and no card model. The prior A2UI review
reached the same conclusion for a declarative catalog
([deep-openclaw-canvas-a2ui §7](../openclaw-hermes/deep-openclaw-canvas-a2ui.md)).
Nothing in OpenUI changes it: OpenUI has fewer components than A2UI's
renderer has today in Flutter/Lit, and its catalog is React-only.

The "safer card views" question is answered by what already exists. The
safe-composition layer in Bee Box is Markdoc: a fixed tag catalog with typed,
validated attributes (`beebox/src/shared/markdoc-config/tags/core.ts`), raw
HTML rebuilt through an allow-list (`html-policy.ts`), unknown tags left as
text. A view author who wants safety uses `Markdown` from
`beebox/view-widgets`, which is the only permitted way to render a card body
([views doc](../../beebox/src/core/views/doc/files.ts), "Card text"). A
second composition language beside Markdoc would be two tiers of the same
thing.

### Chat widgets

The agent's chat reply is streamed Markdown rendered through the same
Markdoc config, plus turn-level tags (`<speech>`, `<callout>`, `<ack>`) and
`control:` links. OpenUI's interactive widgets (forms, buttons whose
`@ToAssistant` step posts a message with form state) map onto a structured
in-chat question. The boxholder closed that as wontfix on 2026-07-10: in
chat the agent asks in prose, the boxholder is present, and the async
`box/questions/` queue is the only structured-question primitive
([closed issue](../../issues/closed/features/2026-06-09-in-chat-interactive-questions.md),
[questions plan, NOT in scope](../../beebox/docs/implemented-plans/questions-end-to-end.md)).
So the form half of OpenUI is out by decision, not by capability.

What remains is display: a table, a chart, a comparison the agent wants to
show once. Today the agent must create a card and embed it (`![x](/path)`),
which is the tension in [ad-hoc agent views](../../issues/exploration/2026-07-28-ad-hoc-agent-views.md).

### Ad hoc views

This is the one place OpenUI's trade-off fits Bee Box's need: a one-off
display that should not be a file, composed from a fixed catalog, streamed
progressively, validated on arrival, and gone when the conversation
scrolls. But the mechanism Bee Box already has for that shape is a Markdoc
block tag with data inside it. Markdoc renders an unclosed tag with its
partial content while the text is still streaming (checked 2026-10-08 with
`Markdoc.parse` on `{% quote %}hello wor`: it renders the open tag, reports
`missing-closing`), so progressive rendering comes free. Named attributes
are validated by `Markdoc.validate`, which `bbx validate` already runs. The
catalog reaches the model the same way OpenUI's does: a text description of
each tag in the agent's guidance.

Concretely, the ad-hoc case becomes two or three new tags, e.g. a
`{% table %}` whose body is a fenced CSV or a Markdown table with declared
column types, and a `{% chart kind="bar" %}` over the same data, rendered by
components the frontend already has or would add for views. The data lives
in the message; no card is minted. If the boxholder later wants it kept,
"save as card" is a copy of the message block into a card body, where it
renders identically. That keeps one language, one validator, one renderer
across cards, chat, and published pages. OpenUI's contribution is the
evidence that a fixed catalog streamed by independently parseable units
works for this job, and the warning that positional arguments are fragile
(a model that writes `direction: "row"` gets an unresolved reference and a
misassigned enum, [hands-on §1](hands-on.md#1-the-language)); Markdoc's
named attributes avoid that.

## 3. Cross-platform, publishing, iOS, other displays

- The iOS app hosts the web client in a WKWebView
  (`ios-app/CLAUDE.md`); anything the web app renders already renders
  there. OpenUI's "React Native" is an export condition, not a renderer
  ([hands-on §6](hands-on.md#6-multi-target-renderers)). No gain.
- Published sites render Markdown to static HTML
  (`beebox/docs/box/publishing.md`). A Markdoc data tag would publish as a
  static table or an SVG chart through the same renderer. OpenUI's email
  renderer is React Email wrappers; not applicable.
- The field converged on MCP Apps (HTML in a sandboxed iframe, 11 hosts)
  for UI that must appear inside someone else's client
  ([alternatives, convergence](alternatives.md#where-the-field-is-converging-evidence)).
  If the box ever serves UI into Claude or ChatGPT, that is the surface,
  and it relates to [box as an MCP server](../../issues/features/2026-09-17-box-as-mcp-server-hands-out-tasks.md),
  not to OpenUI.

## 4. Costs of adopting the packages, for the record

- Dependency: 16 Radix packages, d3, TanStack table, react-markdown, its own
  SCSS theme and CSS variables (2.64 MB minified library). The frontend's
  palette and primitive boundary (`beebox/frontend.md`) would have to wrap or
  re-theme all of it.
- Churn: react-ui 0.17.0 (2026-10-05) renamed and dropped chart props with no
  "breaking" label; changelogs start at 0.3.0.
- Prompt: 9k tokens of catalog per request, or a hand-trimmed library.
- Supply chain: `postinstall` telemetry keyed by git origin; opt-out env var;
  an external hardening PR open since June.
- Governance: one company, no spec file, no process. Forking the parser is
  possible (MIT, ~2,100 lines) but then the "standard" is ours anyway.

## 5. What to take

1. The ad-hoc display case as Markdoc data tags, not as a new language.
   Amended into the ad-hoc views exploration with this evidence.
2. Validation errors shaped for the model (code, path, message, statement),
   which OpenUI feeds back through Autofix. `bbx validate` already reports
   Markdoc errors; when the data tags land, their errors should carry the
   same shape so a chat turn can be corrected. No new issue; it belongs in
   the data-tag design.
3. Measurement discipline: when a token or latency claim is made for a
   format, compare against minified JSON of the same tree and report n.

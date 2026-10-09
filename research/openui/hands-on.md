# OpenUI hands-on (2026-10-08)

Lab: `scratchpad/openui-lab/` (npm packages, scripts, outputs) and a shallow clone at `scratchpad/openui-src/` (commit `c4c0c90`, 2026-10-08). Paths below that start with `packages/` or `benchmarks/` are in the clone.

## Summary

1. OpenUI Lang is a line-oriented assignment language: `name = Component(arg, arg, [refs])`. Arguments are positional, mapped to Zod prop keys by order. v0.5 adds `$state`, `@Builtins`, `Query()/Mutation()`, ternaries, member access.
2. The parser is hand-written TypeScript in `@openuidev/lang-core`: autocloser, char lexer, statement splitter, Pratt expression parser, schema-aware materializer. No PEG, no grammar file, no constrained decoding.
3. Streaming works by appending closers to the pending statement and re-materializing on every chunk; completed statements are cached. Unresolved references are dropped from arrays, not shown as skeletons. Root rendered 11-15 ms after the first token in my runs; first child 20-120 ms after.
4. Components are registered with `defineComponent({name, props: z.object, description, component})`; the catalog reaches the model only as text signatures in the system prompt. Default catalog (82 components, React only, Radix + d3 + TanStack) costs 9,125 tokens of system prompt.
5. Validation is a materializer pass driven by the JSON Schema of the library: unknown component, type mismatch, enum, missing required, excess args. Invalid nodes are dropped or defaulted; errors are reported in `meta.errors`. Nothing throws. Enum checks are skipped while the input is partial.
6. Nothing in the format lets the model emit HTML or JS: there is no HTML node, strings are React-escaped, and the default markdown renderer has no `rehype-raw`. Unknown identifiers like `window.location.href` parse as unresolved refs and render as nothing.
7. The "67% fewer tokens than JSON" is one scenario against a pretty-printed RFC 6902 patch stream. Against minified JSON of the same tree, the repo's own samples show 12% fewer tokens in total (one scenario is 2% more). My three UIs: 16%, 33%, 42% fewer vs minified; 56-67% fewer vs 2-space pretty JSON.
8. Asking the same model (gpt-4.1-mini) for a JSON tree directly used 204/272/519 completion tokens vs 191/370/577 for OpenUI Lang. Direct JSON was fewer tokens in 2 of 3 cases; the UIs were not identical.
9. BYO model is first class in the SDK (system prompt + any chat API; I used OpenAI and Claude via OpenRouter with zero parse errors). Stream-time correction ("Gateway"), Autofix, and reliability monitoring are Thesys-hosted and need a `THESYS_API_KEY`.
10. Renderers that exist: React (reference), Vue 3, Svelte 5, Angular, React Native entry, React Email (44 components), A2UI bridge. Only React has a component library; Vue/Svelte/Angular ship the renderer plus `defineComponent` and expect the host to supply components.

Spend: about $0.07 (6 gpt-4.1-mini calls, 1 claude-sonnet-4.5 call via OpenRouter at $0.035).

## 1. The language

Three verbatim outputs from `gpt-4.1-mini` (temperature 0) given `openuiLibrary.prompt(openuiPromptOptions)` as the system prompt. All three parsed with zero validation errors, zero unresolved references, zero orphaned statements.

Dashboard (prompt: title, table of 5 regions with revenue and growth, bar chart):

```text
root = Stack([title, salesTable, revenueChart])
title = TextContent("Sales Dashboard", "large-heavy")
salesTable = Table([colRegion, colRevenue, colGrowth])
colRegion = Col("Region", regions)
colRevenue = Col("Revenue ($M)", revenues, "number")
colGrowth = Col("Growth (%)", growths, "number")
regions = ["North America", "Europe", "Asia Pacific", "Latin America", "Middle East"]
revenues = [120.5, 95.3, 110.7, 45.2, 30.8]
growths = [5.2, 3.8, 7.1, 2.5, 4.0]
revenueChart = BarChart(regions, [revenueSeries], "grouped", "Region", "Revenue ($M)", 240)
revenueSeries = Series("Revenue", revenues)
```

Form with validation:

```text
root = Stack([title, form])
title = TextContent("Job Application Form", "large-heavy")
form = Form("jobApplication", buttons, [nameField, emailField, phoneField, experienceField, roleField, coverLetterField])
nameField = FormControl("Name", Input("name", "Your full name", "text", { required: true, minLength: 2 }))
emailField = FormControl("Email", Input("email", "you@example.com", "email", { required: true, email: true }))
phoneField = FormControl("Phone", Input("phone", "e.g. +1234567890", "text", { required: true, pattern: "^\\+?[0-9\\-\\s]{7,15}$" }))
experienceField = FormControl("Years of Experience", Input("experience", "Number of years", "number", { required: true, min: 0, max: 50 }))
roleField = FormControl("Role", Select("role", [role1, role2, role3, role4], "Select a role", { required: true }))
role1 = SelectItem("developer", "Developer")
role2 = SelectItem("designer", "Designer")
role3 = SelectItem("product_manager", "Product Manager")
role4 = SelectItem("qa_engineer", "QA Engineer")
coverLetterField = FormControl("Cover Letter", TextArea("coverLetter", "Write your cover letter here...", 6, { required: true, minLength: 50 }))
buttons = Buttons([submitBtn, cancelBtn])
submitBtn = Button("Submit", Action([@ToAssistant("Submit job application")]), "primary")
cancelBtn = Button("Cancel", Action([@ToAssistant("Cancel job application")]), "secondary")
```

Card list (first card shown; cards 2-4 repeat the same 6 statements):

```text
root = Stack([productCards])
productCards = CompositeCardBlock([p1, p2, p3, p4], "grid", true, null, "l")
p1 = CompositeCardItem("runner-elite", p1header, [p1desc], p1footer)
p1header = IconText(p1icon, "neutral", "m", "Runner Elite", "Lightweight performance running shoe", true, "horizontal")
p1icon = Icon("shoe", "shopping")
p1desc = TextContent("Designed for speed and comfort with breathable mesh and responsive cushioning.")
p1footer = { price: BoldText("text", "$120.00"), button: p1btn }
p1btn = Button("View details", Action([@ToAssistant("Show details for Runner Elite")]), "secondary")
```

Claude Sonnet 4.5 via OpenRouter, same system prompt, dashboard prompt: 12 statements, wrapped in a ```` ``` ```` fence (the parser strips fences), zero errors. It put growth as strings (`"+12.3%"`) and typed the column as default string.

Syntax facts, from `packages/lang-core/src/parser/lexer.ts`, `statements.ts`, `expressions.ts`, and `docs/content/docs/openui-lang/specification-v05.mdx`:

- One statement per line: `identifier = Expression`. Newlines inside brackets or a multi-line ternary do not end a statement. Lines without `ident =` are skipped silently (`split()` in `statements.ts`).
- Lexer rule for names: PascalCase token = component type, lowercase = reference, `$name` = state variable, `@Name` = builtin. `true/false/null` are keywords. Strings are `"..."` (decoded with `JSON.parse`) or `'...'`. `//` and `#` comments are stripped.
- Expressions: component call `Type(args)`, arrays, objects `{k: v}`, numbers, references, `a.b.c` member access (on arrays it plucks a field from each element), `a[0]`, ternary, `+ - * / %`, comparisons, `&& || !`. Pratt parser with 9 precedence levels.
- Children are ordinary positional arguments, usually an array of references: `Stack([title, tbl])`. There is no separate children/text syntax. Text is a string argument to a text component.
- Props are positional only. `Stack([x], direction: "row")` is not supported; in my test the parser read `direction` as an unresolved reference and `"row"` as the next positional prop (`align`), and reported an enum type mismatch.
- The first statement named `root` is the entry; else a statement named after the library root; else the first component statement. A program without `root` still renders (`pickEntryId` in `parser.ts`).
- Forward references are allowed. Duplicate names: last assignment wins (Map overwrite), which is also the edit-mode patch mechanism (`merge.ts`).
- Versus JSON: no quoted keys, no `component`/`props` wrapper, no commas between statements, repeated data is named once and referenced. Versus JSX: no closing tags, no attribute names, no text children, and a reference graph instead of a tree. Each statement is a complete, independently parseable unit, which is what makes streaming by statement work.
- Reserved calls: `Query(tool, args, defaults, refreshSeconds?)` and `Mutation(tool, args)` must be top-level statements; inline use is a validation error (`inline-reserved`). Builtins: `@Count @Sum @Avg @Min @Max @First @Last @Filter @Sort @Round @Abs @Floor @Ceil @Each`, action steps `@Run @Set @Reset @ToAssistant @OpenUrl` inside `Action([...])` (`builtins.ts`).

Where the grammar lives: there is no grammar file. The spec is prose in `docs/content/docs/openui-lang/specification-v01.mdx` and `specification-v05.mdx`; the implementation is the hand-written pipeline in `packages/lang-core/src/parser/` (lexer 380 lines, parser 693, expressions 331, materialize 328, validation 398). A blog post (`docs/content/blog/rust-wasm-parser.mdx`) says a Rust/WASM parser was replaced by this TypeScript one because the WASM boundary copy cost more than parsing.

Doc drift: `syntax.mdx` lists `Form(name, fields, buttons)` and `Table(columns)` with `Col(label, data, type?)`; the generated prompt from react-ui 0.17.0 says `Form(name, buttons, fields?)`. The benchmark samples (older react-ui) use `Table(cols, rows)` with `Col(label, type)`. The model follows the prompt, so drift only matters for hand-written examples.

## 2. Streaming

Mechanism (`createStreamParser` in `packages/lang-core/src/parser/parser.ts`):

1. Append the chunk to a raw buffer; re-run `preprocess` (strip fences and comments) to get `cleaned`.
2. Scan forward from a watermark for depth-0 newlines outside strings; each completed statement is tokenized, parsed, and cached in `completedStmtMap`. Completed statements are never re-parsed.
3. The trailing pending text is passed through `autoClose` (`statements.ts`), which appends missing `"`, `)`, `]`, `}` in stack order, then parsed. A pending statement whose name already exists does not replace the completed one until it closes on its own.
4. `buildResult` materializes the whole tree from the entry statement on every chunk. Materialization inlines references, so this is a full re-materialize per chunk, over a cached statement map. Cost is proportional to tree size, not to chunks seen.
5. Every element carries `partial: ctx.partial` (true while any closer was appended). A `Renderer` prop `isStreaming` separately disables form interaction.

Unresolved references are not placeholders. `materializeValue` for `Arr` drops `Ph` (placeholder) and null results from arrays; a scalar slot gets `null`. The v0.1 spec says "renders a Skeleton/Placeholder"; the current renderer renders nothing for the missing child and lets the parent render with what it has.

Observed with `react-dom/server` `renderToString` on a 6-statement dashboard, cut at arbitrary character offsets (`stream-render.tsx`, output in `out/stream-render.txt`):

```text
after 12 chars  "root = Stack"                     tree: null                         html: ""
after 40 chars  ...([title, tbl, chart], "colum   tree: Stack~(children=[], direction="colum")
                                                   html: <div style="display:flex;flex-direction:colum;gap:var(--openui-space-m)"></div>
after 70 chars  ...n", "l")\ntitle = TextContent("  tree: Stack~(children=[TextContent~(text="")], gap="l")
after 140 chars ...tbl = Table(cols, rows)\ncols = [Col("R
                                                   tree: Stack~([TextContent~("Regional Sales"), Table~(columns=[])])
after 200 chars ...                                 tree: Table~(columns=[Col~("Region"), Col~("Revenue")])  Table HTML rendered
after 332 chars (complete)                          tree: all 3 children incl. BarChart; incomplete=false
```

`~` marks `partial: true`. Two things to note: the half-typed enum `"colum"` reached the DOM as an invalid CSS value (enum checks are deferred while partial, see section 4), and an empty `TextContent("")` and an empty `Table` were rendered as empty containers rather than skeletons.

Timings from the live OpenAI stream (`gen.ts`, parser fed per delta; `out/gen-report.json`):

| UI | TTFT | root non-null | first child element | stream complete | deltas |
| --- | ---: | ---: | ---: | ---: | ---: |
| dashboard | 1603 ms | 1617 ms | 1722 ms | 2857 ms | 191 |
| form | 844 ms | 855 ms | 872 ms | 3247 ms | 370 |
| cards | 792 ms | 807 ms | 888 ms | 5054 ms | 577 |

"root non-null" is the first delta where `result.root` existed (after `root = Stack(` arrives). The React `Renderer` (`packages/react-lang/src/Renderer.tsx`) takes the accumulated `response` string as a prop and calls `parser.set(fullText)` (diffing against its buffer) via `useOpenUIState`, then evaluates runtime expressions and renders. An `ElementErrorBoundary` keeps the last good children if a component throws mid-stream.

I did not run a browser; the render evidence is server-side `renderToString`, which exercises the same parser and components but not effects (Query fetching, state).

## 3. Component model

Registration (`packages/lang-core/src/library.ts`, `packages/react-lang/src/library.ts`):

```ts
const StatCard = defineComponent({
  name: "StatCard",
  description: "Displays a metric label and value.",
  props: z.object({ label: z.string(), value: z.string() }),   // Zod 4 only; key order = positional order
  component: ({ props, renderNode }) => <div>...</div>,
});
const library = createLibrary({ root: "Stack", components: [StatCard, ...], componentGroups?: [...] });
```

- Child slots use `Child.ref` (`z.array(Item.ref)`, `z.union([A.ref, B.ref])`). `reactive(z.string())` marks a prop that accepts a `$variable`. `tagSchemaId(schema, "ActionExpression")` names a helper schema for the prompt.
- `library.toJSONSchema()` produces a JSON Schema with one `$defs` entry per component. `createParser(schema)` compiles it to a `ParamMap` (ordered param names, required flags, defaults, sub-schemas) that drives positional mapping and validation. The renderer needs the Zod library; a server needs only the JSON spec (`npx @openuidev/cli generate ... --spec`).
- The catalog reaches the model as text only: `library.prompt(options)` (`packages/lang-core/src/parser/prompt.ts`) emits sections `Syntax Rules`, `Component Signatures` (one line per component, `Name(prop: type, opt?: "a" | "b") — description`, grouped by `componentGroups` with notes), `Action`, `Hoisting & Streaming`, `Examples`, `Important Rules`, `Final Verification`, plus `Built-in Functions`, `Query`, `Mutation`, `Interactive Filters`, `Edit Mode`, `Inline Mode`, `Available Tools` when the corresponding flags/tools are set. No JSON Schema is sent to the model, and no grammar-constrained decoding is used.

Prompt cost of the default catalog (`prompt-size.ts`, tiktoken `o200k_base`):

| Item | Value |
| --- | ---: |
| components in `openuiLibrary` | 82 |
| `prompt(openuiPromptOptions)` | 35,837 chars, 9,125 tokens |
| `prompt({})` (signatures and rules only) | 7,012 tokens |
| `toJSONSchema()` serialized | 12,275 tokens |
| OpenAI-reported `prompt_tokens` per request | 9,166-9,177 (8,960 cached from the second call) |

A large share is repeated union lists: every container slot spells out all 34 allowed child names, e.g. `TabItem(value, trigger, content: (TextContent | MarkDownRenderer | CardHeader | ... | VisualCardBlock)[])`.

Default catalog: `@openuidev/react-ui` 0.17.0, React only. Groups: Layout (Stack, Tabs, Accordion, Steps, Carousel, Separator, Modal), Content (Card, CardHeader, TextContent, MarkDownRenderer, Callout, CodeBlock, Image, ImageGallery, ...), Charts (Bar, Line, Area, Radar, HorizontalBar, Pie, Radial, SingleStackedBar, Scatter + Series/Slice/Point), Table/Col/EditableTable, Forms (Form, FormControl, Input, TextArea, Select, DatePicker, Slider, CheckBoxGroup, RadioGroup, SwitchGroup, Chips, OptionCards), Buttons, and card blocks (Snippet/Overview/Context/Composite/Visual). Dependencies: 16 `@radix-ui/*` packages, `@tanstack/react-table`, `d3-scale/selection/shape` (no recharts), `react-markdown` + `rehype-katex`, `react-day-picker`, `lucide-react`, `react-syntax-highlighter`, SCSS with CSS variables (not Tailwind, not shadcn; a shadcn example exists under `examples/design-systems/shadcn`). Peer deps: `@openuidev/react-headless`, `zustand`, React 18.3+/19.

Restricting the catalog: yes, trivially. `createLibrary({ components: [...] })` with only the host's components; the prompt and parser both derive from that list. Unknown component names are dropped with an `unknown-component` error that lists the allowed names.

Actions: the `Renderer` takes `onAction(event: ActionEvent)`. `Button(label, action)` where `action` is `Action([@steps])`. `@ToAssistant("msg")` dispatches `{type: "continue_conversation", humanFriendlyMessage, formState, formName}` to the host; `@OpenUrl(url)` dispatches `{type: "open_url", params: {url}}` (host decides what to do). `@Run(ref)`, `@Set($v, x)`, `@Reset($v)` are executed inside the runtime (`useOpenUIState.ts`). A button with no action sends its label to the assistant. Form fields are tracked by the renderer; `onStateUpdate`/`initialState` persist them. Queries call `toolProvider` (a `{name: async fn}` map or an MCP client with `callTool`) from the browser; results feed `@Count/@Filter/...` and re-run when a bound `$variable` changes.

## 4. Constraints and failure

Hand-written inputs fed to `createParser(openuiLibrary.toJSONSchema(), "Stack")` (`bad-input.ts`, full output in `out/bad-input.txt`). Nothing threw.

| Input | Result |
| --- | --- |
| `b = DataTable(["x"])` (unknown component) | `b` dropped from `Stack.children`; error `unknown-component` with "Available components: Card, TextContent, ..." (82 names) |
| `TextContent(42, "huge")` | component dropped (required `text` invalid, no default); errors `type-mismatch /text expects string but got number`, `/size expects one of [...] but got "huge"` |
| `TextContent("hi", "gigantic")` | renders with `size` removed; one `type-mismatch` error |
| `Button()` | dropped; `missing-required "/label" — signature: Button(label*: string, action, variant: "primary"\|"secondary"\|"tertiary", ...)` |
| `TextContent("ok", "default", "extra", 7)` | renders; `excess-args: TextContent takes 2 arg(s), got 4 (2 excess dropped)` |
| `t = TextContent("hello` newline `c = Card([x` (unclosed string) | the unclosed string swallows the next line: `text: "hello\nc = Card([x"`; `c` unresolved; `incomplete: true`; no error |
| `TextContent("<script>alert(1)</script><img src=x onerror=alert(2)>")` | string prop, no error; React escapes it: `&lt;script&gt;alert(1)...` |
| `<div onclick="x()">hi</div>` as its own line | line skipped (no `ident =`); no error |
| `Stack([t], direction: "row")` | `direction` becomes an unresolved ref (null), `"row"` lands in `align` and fails the enum check |
| `TextContent(window.location.href)` | parsed as `Member(Member(Ph window).location).href`; `window` unresolved; evaluator yields nothing; no error |
| `a = Card([b])`, `b = Card([a])` (cycle) | `a` rendered, inner `a` dropped; `unresolved: ["a"]`; no error |
| prose + fenced code + prose | fence extracted, prose ignored, renders |
| no `root`, single `t = TextContent("ok")` | `t` becomes the entry |
| a raw JSON object | 0 statements, `root: null` |

Validator vs parser: validation is a pass inside materialization (`materialize.ts` calls `validateSchemaValue` from `validation.ts`), driven by the JSON Schema compiled from Zod. It checks scalar types, enums, object required keys, array items (invalid items pruned), and component position in data slots. Rule at each edge: schema default substitutes; a required edge invalidates the parent (so the component is dropped); an optional edge is deleted. Errors are structured (`code`, `component`, `path`, `message`, `statementId`) and designed to be fed back to the model; `Renderer.onError` surfaces them. Zod itself is not run on the values; only the JSON Schema projection is used.

Streaming relaxations: enum membership and object required-key checks are skipped while `ctx.partial` (`validateLeafValue`, `validateObjectValue`). Scalar type checks stay on. That is why `"colum"` reached the DOM in section 2.

What prevents arbitrary HTML/JS: the language has no HTML node, no eval, and no way to name anything outside the catalog, builtins, and `$state`. Rendered strings are React children (escaped). `MarkDownRenderer`/`TextContent` use `react-markdown` without `rehype-raw`, so `<iframe>` and `<a href='javascript:...'>` rendered as literal text (`html-check.tsx`). `@OpenUrl("javascript:...")` is handed to the host's `onAction` unchanged; `react-ui` exports `safeOpenUrl`/`safeUrl` but the host wires it. `Image(src)` receives whatever string the model wrote. Remaining risks are in host components, not in the format.

No parse exception path was reachable with these inputs; `parse()` is wrapped in telemetry try/catch but every malformed case produced a result object.

## 5. Tokens and latency

Method: for each UI I counted (a) the model's OpenUI Lang output, (b) a JSON tree projected from the parsed AST (`{component, props}` nesting, as in the repo's C1 converter) minified, (c) the same pretty-printed with 2 spaces. Encoder: tiktoken `o200k_base` (matches `gpt-4.1-mini`; OpenAI `completion_tokens` equaled the tiktoken count for the Lang output in all three runs). Column (d) is a separate run asking the same model for a JSON tree directly, given the `$defs` schema as the catalog (10,924 system tokens); its UI differs in details (e.g. `CardHeader` instead of `TextContent`).

| UI | (a) OpenUI Lang | (b) JSON minified | (c) JSON pretty | Lang vs (b) | Lang vs (c) | (d) direct JSON, model usage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard | 191 | 227 | 430 | -15.9% | -55.6% | 204 |
| form | 370 | 549 | 1,072 | -32.6% | -65.5% | 272 |
| cards | 577 | 988 | 1,769 | -41.6% | -67.4% | 519 |

Repo benchmark recount (`recount.ts` over `benchmarks/samples/`, same encoder; the repo uses the `gpt-5` encoder which gives the same o200k counts within a few tokens):

| scenario | OpenUI Lang | C1 JSON as shipped (pretty) | C1 JSON minified | Lang vs minified |
| --- | ---: | ---: | ---: | ---: |
| simple-table | 148 | 322 | 181 | -18.2% |
| chart-with-data | 231 | 498 | 271 | -14.8% |
| contact-form | 294 | 824 | 431 | -31.8% |
| settings-panel | 540 | 1,195 | 656 | -17.7% |
| dashboard | 1,226 | 2,182 | 1,204 | +1.8% |
| pricing-page | 1,195 | 2,285 | 1,362 | -12.3% |
| e-commerce-product | 1,166 | 2,344 | 1,356 | -14.0% |
| TOTAL | 4,800 | 9,650 | 5,461 | -12.1% (vs pretty: -50.3%) |

`benchmarks/thesys-c1-converter.ts` line 39 writes `JSON.stringify(..., null, 2)`; `yaml-converter.ts` uses `indent: 2`; the Vercel JSONL has one JSON Patch op per element with `"op"`, `"path"`, `"value"` keys. `run-benchmark.ts` counts those files as written. The headline "up to 67%" is `contact-form` vs the Vercel patch stream (294 vs 893). Against minified JSON of the same tree, the saving is 12-42% on short UIs and near zero on the data-heavy dashboard, where numbers dominate.

Latency: TTFT to root render was 11-15 ms in all three runs (root is always the first statement, 14 chars). First child element 17-119 ms after TTFT. Direct JSON runs had TTFT 582-919 ms and total 2.65-4.85 s vs 2.86-5.05 s for Lang; not distinguishable at n=1. Claude Sonnet 4.5 via OpenRouter: TTFT 1,752 ms, total 4,692 ms, 256 completion tokens, $0.0346.

## 6. Multi-target renderers

From the clone (`packages/*/src`, line counts exclude tests only where noted) and `gh api` last-commit dates:

| Package | Version | Files / lines in `src` | What it is | Last commit |
| --- | --- | --- | --- | --- |
| `@openuidev/lang-core` | 0.3.2 | 40 / 9,813 | parser, prompt, validation, runtime evaluator, query manager, telemetry | 2026-10-08 |
| `@openuidev/react-lang` | 0.3.2 | 20 / 2,128 | `Renderer`, `defineComponent`, hooks, devtools bootstrap; `react-native` export condition (`index.native.ts`, 4 lines, drops react-dom) | 2026-10-08 |
| `@openuidev/react-ui` | 0.17.0 | 909 / 86,146 | the 82-component default library + chat UI | 2026-10-08 |
| `@openuidev/vue-lang` | 0.3.2 | 12 / 1,874 | Renderer.vue, RenderNode.vue, state, validation; Query/Mutation supported (tests `Renderer.query.test.ts`) | 2026-10-08 |
| `@openuidev/svelte-lang` | 0.3.2 | 9 / 1,008 | Renderer.svelte, RenderNode.svelte, runes-based context; Query support present in Renderer.svelte | 2026-10-08 |
| `@openuidev/angular-lang` | 0.3.2 | 18 / 2,462 | Angular renderer with query support (`query.spec.ts`) | 2026-10-08 |
| `@openuidev/react-email` | 0.3.0 | 47 / 3,241 | 44 `defineComponent` wrappers over `@react-email/components` | 2026-09-15 |
| `@openuidev/a2ui` | 0.3.2 | 13 / 2,475 | A2UI v1.0 envelope with Lang statements in `updateComponents.components` | 2026-10-08 |
| `@openuidev/browser-bundle` | 0.1.5 | 1 / 8 | IIFE of react-lang + react-ui for `<script>` embedding, 3.5 MB unpacked on npm | 2026-10-05 |
| `@openuidev/react-headless` | 0.17.0 | 82 / 10,652 | chat state, stream adapters (OpenAI, Vercel AI SDK, AG-UI) | 2026-10-08 |
| `@openuidev/server` | 0.1.1 | 5 dirs | Autofix client for OpenAI/Vercel/LangGraph; calls `https://api.thesys.dev` | n/a |

Only React has a component library. The Vue, Svelte, and Angular examples under `examples/app-frameworks/` define their own small libraries (Vue: 13 `.vue` files; Svelte: 13 `.svelte` files; Angular: 7 `.ts` files). React Native is an export condition plus an example app, not a separate renderer. "Email" is a component set for React Email rendering. Lang-core tests: 37 parser, 14 materialize/validation, 30 serialize, 11 prompt cases.

## 7. Package facts

- Names: `@openuidev/lang-core` 0.3.2, `@openuidev/react-lang` 0.3.2, `@openuidev/react-ui` 0.17.0, `@openuidev/react-headless` 0.17.0, `@openuidev/cli` 0.5.1, others listed above. The monorepo root is "OpenUI" 1.0.1 (private).
- License: MIT in every package and the repo root (`LICENSE`: "Copyright (c) 2011-2024 Thesys Inc.").
- Install footprint: `node_modules` 328 MB for the lab (includes `openai`, `tsx`, `tiktoken`, React). `@openuidev/react-ui/dist` is 22 MB (components 11 MB, genui-lib 5.6 MB, with source maps). `lang-core/dist` 1.2 MB, `react-lang/dist` 280 KB.
- Bundle sizes (esbuild, minified ESM, externals react/react-dom/zod/zustand): lang-core 84.8 KB (29.1 KB gzip); react-lang including lang-core 94.9 KB (32.7 KB gzip); react-ui `genui-lib` (the default library) 2.64 MB (758 KB gzip) plus SCSS.
- Zod 4 is required (`assertV4Schema` throws on Zod 3 objects).
- `@openuidev/lang-core` has a `postinstall` that sends an install event to PostHog via a CloudFront host (`telemetry/install.ts`, `shared.ts`), including a project id derived from the git origin URL; sampled runtime telemetry also exists for `prompt()` and `parse()`. Opt out with `OPENUI_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`. pnpm 10 blocked the script by default ("Ignored build scripts: @openuidev/lang-core").
- BYO model: the docs' primary tab is "OpenUI Gateway (recommended)" with `THESYS_API_KEY`; the "OpenAI" tab still routes through Thesys Autofix. Plain SDK use needs only `generateSystemPrompt`/`library.prompt` and any chat API. The `create` CLI "asks how to connect to a model".

## Not verified

- No browser render or screenshot; streaming evidence is parser state plus `renderToString`. Query/Mutation, `$state`, and `@Each` were not exercised live.
- Edit mode (`merge.ts`) and inline mode were read, not run.
- Gateway and Autofix behavior (stream-time correction) require a Thesys key; not tested.
- Vue/Svelte/Angular renderers were read, not run.
- Token comparisons are n=1 per UI at temperature 0 with one small model; the direct-JSON UIs are not element-for-element identical.
- The repo's benchmark samples came from `gpt-5.2`; I did not regenerate them.

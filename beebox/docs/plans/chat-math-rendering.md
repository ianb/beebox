---
title: "TeX math renders in chat and card bodies"
status: draft
workstream: chat-math-rendering
issues:
  - ../../../issues/bugs/2026-09-21-chat-chemistry-formula-markup-renders-literally.md
---
# TeX math renders in chat and card bodies

A chat answer or card body that contains `$…$` or `$$…$$` TeX math shows the
raw source today. This plan makes the frontend parser recognize dollar-delimited
math and render it with KaTeX (plus mhchem for `\ce{}` chemistry), loaded only
when a body actually contains math.

**Issues addressed:** `issues/bugs/2026-09-21-chat-chemistry-formula-markup-renders-literally.md`.
Searched `issues/` for `latex|katex|mathjax|\ce{|math render|equation`: the
only other hit is a closed Drive round-trip bug, unrelated.

## Design

### Situations

- When I ask the box to check my chemistry homework and it answers with a
  balanced equation, I want to see H₂ + Cl₂ → 2 HCl, so I can compare it with
  my worksheet without decoding `\ce{}`.
- When a physics answer gives a formula in the middle of a sentence, I want it
  set as a formula in the line of text, so the sentence still reads as prose.
- When the box tells me a plan costs $5 and the upgrade $10, I want plain
  dollar amounts, so the message does not turn into italic math. (The case
  where the person does not want this feature.)
- When a long derivation is still streaming, I want the text to keep flowing,
  so I can read along before the formula finishes.

### Right place, right time

Math renders wherever box Markdown renders in the app: chat messages and card
bodies (the boxholder's decision, 2026-11-10). Nothing new interrupts; the
formula replaces the source text in place.

### Spirit and trust

Serves "feel possible": a chemistry or physics conversation works the way the
person expects from other chat tools. Risks "see the gears" only on failure,
covered below. No action is taken on the person's behalf, so trust rungs do not
apply.

### Wrong or nothing

- TeX that KaTeX cannot parse shows its source in code style (monospace, dollar
  signs included), so the person sees what the agent wrote.
- While the renderer loads (first math in a page load) the source shows in code
  style, then switches to the formula.
- An unclosed `$$` while streaming stays plain text until the closing `$$`
  arrives.
- Published pages keep showing the source text. A follow-up issue records
  this (Implementation order, chunk 4).

## Smallest fix and budget

Smallest fix: guidance telling agents to write Unicode formulas
(`H₂ + Cl₂ → 2 HCl`), as the issue's research suggested. It does not meet the
boxholder's requirement that TeX "should be possible to use … With markdown
conventions etc.": a Unicode-only answer leaves `$…$` raw. Simple formulas can
still be written in Unicode.

Chosen design, one track:

- Parser rule (inline `$`/`$$`, block `$$`) and token rewrite: ~170 lines.
- Math React component and lazy renderer module: ~90 lines.
- Render config wiring: ~10 lines.
- Tests (parser rules, false positives, render fallback, lazy-import guard):
  ~200 lines.
- Docs: `docs/box/markdown.md` (~15 lines), agent-guide ledger/guide line (~2),
  one knowledge audit (~20).
- Dependency: `katex` in `beebox/src/frontend/package.json`.

Total ~470 changed lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Boxholder, 2026-11-10: "The goal is NOT adding a ton of overhead when most
  conversations won't use ANY latex." Drives the lazy chunk and the bundle
  measurement.
- Boxholder, 2026-11-10, on `\(…\)`/`\[…\]`: "Let's not put them in … One way,
  we'll see if errors come up." Only dollar delimiters.
- Memory "minimize invented concepts": reuse the footnote precedent (plugin
  tokens rewritten to Markdoc tags) instead of a new node type.
- `beebox/AGENTS.md` "no features beyond the task": no publish-path rendering,
  no editor support.

## What already exists

- Footnote precedent, reused: `beebox/src/shared/markdoc-config/parse/core.ts:51`
  *"md.use(footnote);"* and `parse/footnote-tokens.ts:34` `asTag`, which
  rewrites a plugin token *"token.type = token.nesting === 1 ? "tag_open" …"*
  with attributes in `meta`. The math tokens use the same rewrite.
- Frontend parser, extended: `beebox/src/frontend/src/lib/markdoc-parse.ts:14`
  *"const parser = createMarkdownParser({ linkify: true });"*. It feeds the
  shared renderer (`components/Markdown/body.tsx:368`
  *"const ast = parseMarkdown(…)"*), which chat uses via
  `components/chat/markdown-rendering.tsx:234` *"<Markdown components={CHAT_MARKDOWN_COMPONENTS} …"*.
- Render-only tag precedent, reused: `body.tsx:196` `includeFileTag`,
  *"It is not in the shared tag table, so no agent writes it."*
- Agent doc that currently says math is unsupported:
  `beebox/docs/box/markdown.md:112` *"`==highlight==`, `:emoji:` shortcodes, and math."*
- CSP allows same-origin fonts and inline styles: `beebox/src/lib/csp.ts:41`
  *"["font-src", "'self'"]"*; KaTeX's bundled fonts and inline `style`
  attributes fit.
- No existing math dependency: `katex@0.16.47` appears in `pnpm-lock.yaml` only
  under `micromark-extension-math` (a transitive dependency of a dev tool), not
  in the frontend.

## Prior art (external)

- Pandoc `tex_math_dollars` rule: opening `$` not followed by whitespace,
  closing `$` not preceded by whitespace and not followed by a digit.
  https://pandoc.org/MANUAL.html#extension-tex_math_dollars — adopted (rule
  only, no code).
- `markdown-it-dollarmath` (executablebooks) implements the same rule; last
  published 2023, peer `markdown-it ^12 || ^13`. Evaluated-only: unmaintained,
  and a ~100-line rule avoids the dependency.
- KaTeX `trust: false` (default) disables `\href`, `\url`, `\includegraphics`
  and HTML extensions; KaTeX documents its output as safe for untrusted input
  under that setting. https://katex.org/docs/security — adopted.
- KaTeX ships mhchem as `katex/contrib/mhchem`, a side-effect import that
  registers `\ce` and `\pu`. https://katex.org/docs/libs — adopted.

No ACKNOWLEDGEMENTS entry: the Pandoc rule is a convention, not copied code.

## Ontology

- **Math span** (new): a `$…$` or `$$…$$` run in Markdown source, recognized
  by the frontend parser. Identified by its delimiters. Not a Markdoc tag an
  author writes.
- **`math` tag** (new, render-only): the Markdoc tag the token rewrite emits,
  attributes `tex` (string, raw source between delimiters) and `display`
  (boolean). Not in the shared tag table (`@shared/markdoc-config`), like
  `include-file`.
- **`MathFormula`** (new): the one React component the tag renders to, with
  `display` (display mode) and `block` (its own lines) props. One component,
  since the two shapes differ only in wrapper element.
- **Math renderer module** (new, `math-render.ts`): the one module that
  imports `katex`, mhchem and KaTeX's CSS, loaded by dynamic `import()`.

## Tracks / scope

### Track 1: dollar math in the frontend renderer

**What.** Add a markdown-it inline rule and block rule for dollar math to the
parser behind `createMarkdownParser`, enabled by a `math: true` option that
only `lib/markdoc-parse.ts` passes. Rewrite their tokens to `math` tags. Render
the tags through a component that lazy-loads KaTeX with mhchem.

**Why.** Chat and card bodies show raw TeX (the issue's screenshots 20 and 21).

**Direction.**

- `parse/math-rule.ts` (shared): `mathPlugin(md: MarkdownIt): void`.
  - Inline rule, registered before `escape`:
    - `$$…$$` on one inline run: display math inside a paragraph.
    - `$…$`: opening `$` not followed by whitespace or `$`; closing `$` not
      preceded by whitespace, not preceded by `\`, not followed by a digit.
      Content non-empty. `\$` inside is kept literally for KaTeX.
    - A `\$` outside math stays the existing Markdown escape (literal `$`).
  - Block rule, registered before `paragraph`: a line starting with `$$`
    opens; the block ends at the first line ending with `$$`. No closing line:
    the rule does not match, so the text stays a paragraph (streaming case).
    A blank line before the closing `$$` also fails the match, which bounds
    how much text a stray `$$` can swallow.
    Registered with `alt: ["paragraph", …]` so it interrupts a paragraph
    (`prose\n$$x$$`).
  - Code spans and fences already take precedence (the `backticks` inline rule
    and `fence` block rule run earlier).
- `parse/math-tokens.ts`: rewrite `math_inline`/`math_block` tokens with the
  `asTag` shape into `{ tag: "math", attributes: { tex, display } }`. A block
  token becomes a self-closing block tag.
- `createMarkdownParser({ linkify, math })`: `math` defaults false. The
  backend walkers, publish renderer and `compose/scan.ts` keep the plain
  parser and see dollar text as before.
- `body.tsx`: render-only `mathTag` transforming to `MathFormula` with
  `{ tex, display, block: !node.inline }`.
- `components/Markdown/Math.tsx`: a module-level cache of the loaded renderer,
  so a formula mounted after the first load renders on first paint. Before
  load: code-style source. After load:
  `katex.renderToString(tex, { displayMode, throwOnError: true, trust: false, maxSize: 20, strict: "ignore" })`.
  Parse error: code-style source, title "Formula did not render: <KaTeX
  message>". Chunk load failure: code-style source, title "The formula
  renderer did not load.", console error, and the next formula retries.
  Server-side rendering never runs the effect, so it renders the source.
- `components/Markdown/math-render.ts`: the only `katex` importer; imports
  `katex/contrib/mhchem` and `katex/dist/katex.min.css`. mhchem (~34 kB
  minified) rides in the same chunk: a second deferred load would save little
  and add a state.
- Frontend test load hook (`src/frontend/test/helpers/react-compiler-hooks.ts`)
  loads a `.css` import as an empty module, as Vite turns it into a
  stylesheet; without it the component test cannot import the renderer.

**Vocabulary lock-ins.** Tag name `math`; attributes `tex`, `display`;
component name `MathFormula`.

**First implementation chunk.** Parser rule, token rewrite, and parser tests
(delimiters, prices, shell text, code spans, `\$`, unclosed `$$`). No UI.

## Could this be simpler?

Simplest version: a regex pre-pass over the source that wraps `$…$` in a
component before Markdoc parses. It fails on code spans and fences (a shell
snippet `echo $A $B` in backticks would become math) and on Markdown escapes:
by the time Markdoc's AST exists, `\\` and `\{` inside the TeX are already
unescaped. The parser rule sees the raw source and respects code, so it buys
correctness for the price-and-shell false-positive cases the boxholder named.

Eager KaTeX import would be ~10 fewer lines; it fails the boxholder's
zero-overhead requirement.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Prices `$5 and $10` become math | Planned (parser test) | Pandoc digit/space rule | Clear (italic math in a price message) |
| `` `echo $HOME $PATH` `` in a code span becomes math | Planned | Backticks rule runs first | Clear |
| Unparseable TeX | Planned (render test) | Fallback to code-style source | Clear |
| Lazy chunk fails to load (offline, deploy swapped chunks) | No | Fallback stays; error logged to console | Clear (source visible) |
| A static `katex` import slips into the main bundle | No (measured at build, not guarded) | None | Silent: bundle grows ~290 kB; accepted, review sees an import of `katex` |
| A formula with a huge `\rule` or size covers the page | Yes | `maxSize: 20` (ems) | Clear |
| Streaming unclosed `$$` breaks layout | Planned (parser test: no match) | Rule requires the closing line | Clear |
| KaTeX output as HTML injection | No (library property) | `trust: false`, KaTeX escapes text | Silent if KaTeX regresses; accepted, KaTeX's documented contract |
| Block `$$` containing a blank line | Yes | Block rule stops at a blank line; text stays a paragraph | Clear |
| Backend walkers read Markdown syntax inside a formula (a Markdown link written inside a formula is still a link to body-refs and lint) | No | None | Silent; accepted: TeX does not contain Markdown link syntax in practice, and recognizing math in the shared parser would add math handling to the briefing emitter, lint and publishing |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong delimiter (`\(…\)`): GAP accepted by the boxholder; shows as text
  `(…)` and the guidance names only dollars.
- Intention lines (`intention/IntentionLine/MarkdownInline.tsx`) show any
  line containing a tag as its source, so a `$…$` there stays text, as today.
- Hand-edit drift (`$ x $` with spaces): renders as text, by the Pandoc rule.
  ADDRESSED in `markdown.md` with one sentence.
- Hand-written `{% math tex="…" /%}`: renders in the app, like `include-file`.
  Backend lint flags it as unknown (plain parser's tag table lacks it).
  Accepted.
- Stale ref, two agents, migration: not applicable; no stored state changes.

## NOT in scope

- `\(…\)`, `\[…\]`: boxholder decision, 2026-11-10.
- Published pages (`src/publish/`): would need server-side KaTeX and shipping
  fonts in the bundle. Filed as a follow-up issue.
- Speech: TTS reads only `<speech>`-tagged text, which the agent writes
  separately (`chat/message-parsing.ts:202` `stripSpeechTags`). A guidance
  line says to say formulas in words there.
- Backend walkers (briefing emitter, body refs, lint): they keep seeing dollar
  text, which is the source the agent wrote.
- Editor highlighting of math in the card editor.
- iOS: chat is the web view; no native Markdown renderer (confirmed in Track
  verification).

## Open design questions

none

## Knowledge audits

New agent-facing convention: "math renders; use `$…$`/`$$…$$`; `\ce{}` for
chemistry; say formulas in words inside `<speech>`". One `knows_directly`
audit, `markdown-math`, run on the worktree test1 clone.

## What will hold this after it ships

- Parser tests in `beebox/test/shared/` beside
  `markdoc-config.footnotes.test.ts`: delimiters and false positives. The
  decision is a pure function of the source, so the cheapest tier reaches it.
- A frontend component test in `beebox/src/frontend/test/components/Markdown/`
  for fallback output with KaTeX unavailable or failing.
- A unit check of `renderTex` for the `maxSize` cap.
- No source-scan test for the lazy import: the build output shows the chunk
  split, and the measurement is in the commit message.

## Implementation order

1. Parser rule + token rewrite + parser tests.
2. `katex` dependency, `Math.tsx`, `math-render.ts`, `body.tsx` wiring,
   component test. Measure main bundle before/after.
3. `markdown.md`, agent-guide ledger line, knowledge audit (run).
4. Follow-up issue for published pages. Screenshot exhibit.

## Rollout shape

Done when the parser tests and component test pass;
`pnpm typecheck` and `pnpm layout-check` pass; the bundle measurement shows the
main chunk unchanged within the component's size; and the exhibit shows inline
math, display math, a `\ce{}` formula, and a dollar-amount message as text.
No data migration.

## Plan review (cross-model, codex gpt-6-sol, 2026-11-10)

- Backend parser sees Markdown inside formulas: rejected, near-nil
  reachability; recorded in Failure modes.
- `maxSize` unbounded: fixed (`maxSize: 20`, tested).
- Guidance must not imply published pages render math: fixed in
  `markdown.md`.
- Block rule must interrupt a paragraph: `alt: ["paragraph", …]`; tested.
- Failed load looks like loading: fixed with a title on the source.
- One component, mhchem in the same chunk, measure instead of a source scan:
  adopted.
- Citation line numbers and "issue filed" wording: fixed.

## Measurements

Vite production build, before and after (main chunk `index-*.js`):

| | Before | After |
|---|---|---|
| Main JS | 1,849.90 kB (593.91 kB gzip) | 1,853.90 kB (595.47 kB gzip) |
| Main CSS | 295.93 kB (47.13 kB gzip) | 295.93 kB (47.13 kB gzip) |
| `math-render` JS (lazy) | none | 292.54 kB (86.13 kB gzip) |
| `math-render` CSS (lazy) | none | 30.20 kB (8.08 kB gzip) |

KaTeX fonts load from the lazy CSS only for the glyphs a formula uses.

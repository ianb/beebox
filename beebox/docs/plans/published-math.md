---
title: "TeX math on published pages"
status: draft
workstream: chat-math-rendering
issues:
  - ../../../issues/features/2026-11-10-published-pages-render-tex-math.md
---
# TeX math on published pages

Chat and card bodies render `$…$` and `$$…$$` TeX in the app
(`docs/implemented-plans/chat-math-rendering.md`). A published Markdown page
still shows the dollar-delimited source. This plan renders the same math on
published pages, as MathML produced at publish time.

**Issues addressed:** `issues/features/2026-11-10-published-pages-render-tex-math.md`.
Searched `issues/` for `math|katex|mathml|publish.*formula`: no other open item.

## Design

### Situations

- When I publish my chemistry study notes, I want the reaction equations on
  the page to look like they do in the app, so a classmate can read them.
- When I publish a price list ("$5 and $10"), I want it to stay plain text.
- When a reader opens the page on an older browser, I want the formula to
  still be readable rather than missing.

### Right place, right time

Static publish only; nothing new appears in the app. The formula replaces its
source on the page.

### Spirit and trust

Serves "feel possible": a page published from the box reads like the box.
No action on the person's behalf; trust rungs do not apply.

### Wrong or nothing

- TeX that KaTeX cannot parse publishes as code-style source, as in the app.
- A browser without MathML support shows the formula's text content in a
  line (MathML degrades to its token text). All current engines (Chromium
  109+, Firefox, Safari) render MathML Core.

## Smallest fix and budget

Smallest fix: render math on publish with KaTeX's default HTML output, which
needs KaTeX's CSS and 20 font files shipped in every bundle with math. The
publish renderer is self-contained by design:
`src/publish/prepare/core/markdown-page.ts:60` *"Self-contained inline
stylesheet: no `url(...)`, no font imports"*. MathML output needs no CSS,
fonts or script, so it is both smaller and fits that rule.

Estimate: ~60 source lines (`markdown-page.ts`, a math helper), ~50 test
lines, ~3 doc lines, `katex` added to `beebox/package.json`.

## Stated preferences this plan trades against

- Boxholder: "NOT adding a ton of overhead when most conversations won't use
  ANY latex". That concerns conversations; the app already loads KaTeX only
  for math. The publish module imports KaTeX statically (plan review: lazy
  loading on the backend buys nothing measured).
- `markdown-page.ts:14` *"Pure and deterministic given the source"*: KaTeX
  output is deterministic for a given input.
- Leak scan flags any `http(s)://` text (`src/publish/leak-scan.ts:95`
  `EXTERNAL_URL_RE`); KaTeX's `<math xmlns="http://www.w3.org/1998/Math/MathML">`
  would trip it, so the `xmlns` attribute is dropped (HTML parsing puts
  `<math>` in the MathML namespace without it).

## What already exists

- Parser option, reused: `createMarkdownParser({ linkify, math })`
  (`src/shared/markdoc-config/parse/core.ts`), currently `math: true` only in
  the frontend (`src/frontend/src/lib/markdoc-parse.ts:14`).
- Publish render path, extended: `renderMarkdownPage` and
  `markdownValidationErrors` (`markdown-page.ts`), called from
  `prepare/core/markdown.ts:88-97`. `rewriteHtml` already post-processes the
  rendered body string (link rewriting).

## Prior art (external)

- KaTeX `output: "mathml"` emits MathML only, no HTML spans.
  https://katex.org/docs/options — adopted.
- MathML Core in Chromium 109 (2023); already in Firefox and Safari.
  https://developer.mozilla.org/en-US/docs/Web/MathML — premise for no fonts.

## Ontology

No new nouns. Reuses the `math` tag (`tex`, `display`) from the parser.

## Tracks / scope

### Track 1: MathML on published pages

**Direction.**

- `markdown-page.ts` parses with a module-level
  `createMarkdownParser({ linkify: false, math: true })` for both
  `markdownValidationErrors` and `renderMarkdownPage`.
- `docRenderConfig()` adds a `math` tag whose transform pushes `{ tex,
  display }` onto a per-render list and emits `<bbx-math n="i">`. After
  `renderers.html` and `rewriteHtml`, each `<bbx-math n="i"></bbx-math>` is
  replaced by KaTeX MathML (or escaped code-style source on a parse error).
  Replacing after `rewriteHtml` keeps link rewriting away from MathML.
- `extractTitle` includes a math tag as `$tex$`, so `# E = $mc^2$` titles
  the page `E = $mc^2$`.
- `publish/prepare/core/math.ts`: `texToMathml(tex, display): string`,
  importing `katex` and `katex/contrib/mhchem`; options `output: "mathml"`, `throwOnError: true`, `trust: false`,
  `maxSize: 20`, `strict: "ignore"`; strips ` xmlns="…"`.
- `DOC_CSS` gains one rule so a display formula scrolls instead of widening
  the page: `math[display="block"] { overflow-x: auto; }`.

**First implementation chunk.** All of the above plus tests; it is one chunk.

## Could this be simpler?

KaTeX's HTML output with CSS and fonts is the established path, but it breaks
the publish rule against `url(...)` and adds ~300 kB of fonts per bundle.
MathML is the simpler version here.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Leak scan flags the MathML namespace URL | Planned | `xmlns` stripped | Clear (finding shown on preview) |
| Invalid TeX | Planned | Escaped code-style source | Clear |
| `$` math tag rejected by publish validation | Planned | `math` tag in `docRenderConfig` | Clear (publish error) |
| Placeholder text authored by hand (`<bbx-math n="0">`) | Planned | Raw HTML goes through the allow-list; an unknown element publishes escaped, as text | Clear |
| Browser without MathML | No | Token text shows | Clear |
| A math heading loses its formula from `<title>` | Planned | `extractTitle` reads math tags | Clear |
| `\href` and other trust-gated commands render red and drop their text | No | None | Visible red command; accepted, as in the app |

## Agent-flow / user-flow edge cases

- Redacted content: math inside `{% redacted %}` is dropped with its parent
  by `omitRedacted`, before the placeholder pass. ADDRESSED by order.
- Hand-edit drift and wrong delimiters: same rules as the app. ADDRESSED in
  `docs/box/markdown.md`.

## NOT in scope

- Published view renderers (non-Markdown publications): they render through
  their own code, not `renderMarkdownPage`.
- Changing the app's KaTeX HTML output to MathML: the app has its own CSS and
  fonts and the HTML output is more consistent across browsers.

## Open design questions

none

## Knowledge audits

No new concept: `markdown.md` drops "Published pages show the TeX source".
The existing `markdown-math` audit still covers the convention.

## What will hold this after it ships

Tests in `test/publish/prepare.math.test.ts`: rendered page contains `<math`
for inline and display, no `xmlns`, prices stay text, invalid TeX publishes as
code, and the leak scan reports nothing for a math page.

## Implementation order

1. `katex` dependency in `beebox/package.json`; `math.ts`; `markdown-page.ts`;
   tests; docs. One commit.

## Rollout shape

Done when the publish tests pass, typecheck and change-selected tests pass,
and a published sample page with math opens in a browser showing formulas.
No data migration.

## Plan review (cross-model, codex gpt-6-sol, 2026-11-10)

- MathML keeps the TeX in a hidden `<annotation>` (and `\phantom` text):
  rejected. A published page today ships the same TeX visibly; the author
  wrote it in the published source.
- Title loses math: fixed (`extractTitle`).
- `\href` under `trust: false` renders red instead of falling back: accepted
  risk, same as the app; agents do not write it in formulas.
- Hand-written `{% math %}` is authorable: accepted, same render-only tag as
  the app.
- Lazy `createRequire`: cut, static import.

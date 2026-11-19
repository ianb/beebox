---
title: "Text and code files on the card surface, with syntax highlighting"
status: draft
workstream: code-file-card
issues: []
---
# Text and code files on the card surface, with syntax highlighting

A text file that is not a card or Markdown (`.ts`, `.py`, `.txt`, `.yaml`, …) renders as bare monospace on the page background. This plan puts those files on the same themed card surface that `.md` files use, and colours code by language with a small, lazily loaded highlighter.

**Issues addressed:** none. Searched `issues/` for "syntax highlight", "highlight.js", "plaintext": no hits.

## Design

No full bbx-design pass: this changes the frame and colouring of an existing view, with no new behaviour, record, or interaction.

- **What a person sees.** Opening `src/foo.ts` shows the same card a `.md` file shows: the box's card theme, the title (the file name), the properties corner, and the "open in panel"/chat actions. The body is the file's text in monospace, with keywords, strings, comments, numbers, and names coloured. A `.txt` or `.log` file gets the card with uncoloured text.
- **Themes.** Token colours derive from the theme's own ink and pen, so they read on every card theme, light or dark.
- **Large files.** Above 256 Ki characters (`text.length`) the highlighter does not run; the file shows uncoloured on the card. The text is never hidden behind the highlighter: it shows uncoloured first and gains colour when the highlighter chunk arrives.
- **Properties face.** The back of the card names the file type ("TypeScript", "Text"), not "Markdown" as it does today for every non-card file (`PropertiesFace.tsx:52`), and the appearance hint says "Files take the box's appearance".
- **Chat.** In chat a plaintext file loses the old header's Chat/Trash menu (`FileView/view.tsx:113`), as `.md` files already do on the themed card. Accepted for parity; the sidebar and browse links remain.
- **Embeds.** A text file embedded in another card (`![](view:…)`) stays frameless, as today. It is highlighted.

## Smallest fix and budget

Smallest fix: return true from `usesThemeSurface` for plaintext paths and wrap the renderer body in `CardThemeContent`. About 10 lines.

Chosen design adds a highlighter component and a token stylesheet. Estimate: source and tests ~200 lines; authored docs ~5 (what's-new line); generated output: lockfile lines for one dependency.

## Stated preferences this plan trades against

- Handoff (paraphrase of the developer): "a basic card container for it, and ideally syntax highlighting"; "If the highlighter adds a heavy dependency (more than ~100 KB gzipped on first load), stop and ask before landing."
- Handoff: "Do this through the existing card surface/primitive, not a one-off frame." The plan reuses `ThemedFileCard` and `CardThemeContent`.
- Root AGENTS.md dependency rule: edit `package.json`, `pnpm install --lockfile-only`, check the lockfile diff, `pnpm install`.
- Memory "Minimize invented concepts": token colours come from existing `--bbx-ink`/`--bbx-pen`/`--bbx-ink-soft`, no per-theme syntax palette.

## What already exists

- `beebox/src/frontend/src/components/FileView/view.tsx:149-151` — `function usesThemeSurface(path: string): boolean { return isCardPath(path) || isMarkdownPath(path); }`. The only gate for the themed card. Reuse: extend it.
- `beebox/src/frontend/src/components/FileView/view.tsx:345-348` — `if (usesThemeSurface(path)) { return <ThemedFileCard … >{body}</ThemedFileCard>; }`. Runs after the frameless (`embed`/`strip`) return at `:337-343`, so embeds are unaffected.
- `ThemedFileCard` (`components/themes/ThemedFileCard/view/ThemedFileCard.tsx`) already handles non-card files: `isCard` gates the card-only parts (`cardChoice: isCard ? data.frontmatter?.theme : undefined`, `actions={isCard ? <CardActions …/> : null}`), and `cardTitle(data)` falls back to `displayName(data.path)` (`lib/card-title.ts:20`). `.md` already exercises this path. Reuse as-is.
- `renderers/markdown.tsx:15` — `if (mode !== "embed") return <CardThemeContent>{content}</CardThemeContent>;`. Precedent for the renderer side: `CardThemeContent` gives `.bbx-card-content` padding and max width (`themes/card-themes.css:179-182`).
- `renderers/plaintext.tsx:14-23` — current body: `<div className="p-4"><Pre>{data.content}</Pre></div>`. Its selector (`:26-37`) matches: has an extension, not `.card`, not `.json`, not binary. It also matches `Name.attach` directories, which the Directory renderer outranks; the new `isPlaintextPath` excludes them via `isDirectoryPath` (`file-view-data.ts:37`).
- `components/Markdown/Math.tsx:19-30` — precedent for a lazily imported renderer chunk (`loading ??= import("./math-render")…`) with source shown until it loads. Copy the pattern.
- `Pre` (`components/ui/Pre.tsx`) — monospace, `whitespace-pre-wrap`, ink from the material. Reuse for the uncoloured body and as the highlighted body's element.
- Data loading: `components/file-view-data.ts` `useFileData` fetches the full text for every non-card, non-dir, non-binary, non-JSON path, with no size gate. Plaintext has no size gate today.
- No highlighter in the frontend: `src/frontend/package.json` has only `@codemirror/commands|state|view` (no language packages). Searched for `highlight|prism|shiki|lowlight|lezer`.

## Prior art (external)

- highlight.js 11.12.0 (published 2026-08-12). `highlight.js/lib/core` plus per-language modules `highlight.js/lib/languages/<name>`, each a separate import, so each can be a lazy chunk. `hljs.highlight(code, { language })` returns HTML with `<span class="hljs-…">` and escapes the source text. Adopted (dependency, not copied code): no ACKNOWLEDGEMENTS entry needed for a normal dependency. UNVERIFIED until build: size. Gate: compare production builds before and after; sum added gzipped assets for (a) ordinary startup and (b) a cold open of a `.ts` file, shared chunks and CSS included. Over ~100 KB on either: stop and ask the developer.
- Shiki: TextMate grammars plus a WASM regex engine; first-load cost well over 100 KB. Evaluated only, rejected on size.
- CSS relative colour syntax `oklch(from var(--x) l c h)`: Chrome 119, Safari 18, Firefox 128. Adopted for token colours. An unsupporting browser drops the declaration and the token inherits ink (uncoloured, still readable).

## Ontology

- **Plaintext path** — existing: the plaintext renderer's selector (`renderers/plaintext.tsx:26-37`). Exported as `isPlaintextPath(path)` so FileView and the renderer share one definition.
- **Code language** — new: a highlight.js language name chosen from the file extension by a fixed table. `null` means "no highlighting" (`.txt`, `.log`, unknown extensions).
- **Highlight limit** — new constant: 256 KiB of text. Above it, no highlighting.

## Tracks / scope

### Track 1 — card surface for plaintext files

- What: plaintext paths render inside `ThemedFileCard`; the plaintext renderer wraps its body in `CardThemeContent` except in `embed` mode.
- Why: today the text sits on the page background with no card (the reported problem).
- Direction: `export function isPlaintextPath(path: string): boolean` in `renderers/plaintext.tsx` (the selector calls it). FileView: `usesThemeSurface = isCardPath || isMarkdownPath || isPlaintextPath`. Renderer: `mode !== "embed" ? <CardThemeContent>…` : `<div className="p-4">…`, as `markdown.tsx` does.
- Depends on: `usesThemeSurface` is the only gate (read at `view.tsx:149`; its only caller is `:345`, searched `usesThemeSurface` in `src/`). ThemedFileCard tolerates non-card data (`.md` precedent, quoted above).
- First chunk: the two edits, the properties-face file-type label, plus tests: `.ts` is a plaintext path and `x.attach` is not.

### Track 2 — syntax highlighting

Ships as a separate commit after Track 1, which is complete on its own.

- What: `components/CodeText/` with `CodeText({ text, language })`. It renders `<Pre>` with the text; once the highlighter chunk for that language loads, it renders the highlighted HTML in a `<code>` inside the same `<pre>`. The result is stored with the text and language it came from and shown only while they match the current props. A rejected import or a throwing `highlight()` leaves plain text.
- Why: the developer asked for it; code is the main kind of plaintext file in a box.
- Direction: `languageForPath(path): string | null` (pure, table-driven: ts/tsx/mts/cts→typescript, js/jsx/mjs/cjs→javascript, py→python, sh/bash/zsh→bash, yaml/yml→yaml, toml/ini/cfg→ini, css→css, html/htm/xml→xml, sql→sql, go, rs→rust, java, kt→kotlin, swift, rb→ruby, c/h→c, cpp/cc/hpp→cpp, diff/patch→diff). `code-highlight.ts` (lazy chunk) imports core and loads languages by dynamic import from a static map. Highlight runs only when `text.length <= HIGHLIGHT_LIMIT`. Token styles in `themes/card-themes.css` under `.bbx-code`, from `--bbx-ink`, `--bbx-ink-soft`, `--bbx-pen`, with hues via `oklch(from var(--bbx-ink) l …)`.
- Vocabulary lock-ins: `CodeText`, `languageForPath`, `.bbx-code`.
- Depends on: `dangerouslySetInnerHTML` precedent for library-escaped HTML: `components/Markdown/Math.tsx:75`. highlight.js escapes input (library documentation; checked by a test with `<script>` in the source).
- First chunk: `languageForPath` with its test, then `CodeText` and the stylesheet.

## Could this be simpler?

Track 1 alone answers "no card". It fails the second ask (highlighting). Highlighting without lazy loading would put core and all languages in the main bundle for every page; the lazy chunk keeps the first load unchanged. A per-theme syntax palette was rejected: it is one more thing every theme must define.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Highlighter chunk fails to load, or `highlight()` throws | planned | text stays uncoloured | clear: text readable |
| A 256 Ki-character `.ts` file blocks the main thread | timed in browser on `big.ts` at the boundary; limit lowered if slow | size limit | clear: uncoloured text |
| Highlight result from older text shown after a file change | planned | result keyed on text+language | — |
| Token colour unreadable on a theme | browser contrast check, light and dark themes | inherits ink when relative colour unsupported | visible |
| Source contains `<script>` and is injected as HTML | planned | hljs escaping | — |
| Theme without relative-colour support | no | declaration dropped → ink | clear |
| Embedded text file gains a card frame inside another card | planned (embed stays frameless) | frameless return precedes surface | — |

No critical gap.

## Agent-flow / user-flow edge cases

Walk, way in: person opens `/src/foo.ts` → FileView `useFileData` fetches text (`file-view-data.ts`, `fetchText` true) → `getRenderers` picks Plaintext → not frameless → `usesThemeSurface` true → `ThemedFileCard` with title `foo.ts` → `PlaintextRenderer` wraps `CodeText` in `CardThemeContent` → uncoloured text paints → chunk loads → coloured. Way out: navigation unmounts; the module cache keeps loaded languages for the page's life. File changes on disk → `useLiveRefresh` refetches → `CodeText` re-highlights the new text.

- Wrong tag / wrong field: no agent-written vocabulary. ADDRESSED (n/a by design).
- Stale ref: unchanged FileView behaviour. ADDRESSED.
- Two agents / hand-edit drift / fabricated value / validation UX / partial migration: no stored state or agent input. ADDRESSED.
- Stored state that never clears: module-level loaded-language cache only; cleared on reload. ADDRESSED.

## NOT in scope

- Markdown code fences: highlighting them is a separate change (fences sit on dark code paper, and many fences in chat carry drafted prose). Filed as an issue.
- JSON files on the card surface: JSON has its own size-gated renderer and the `.comments.json` renderer; left as is, filed with the fences issue.
- Size gate for plaintext fetching: today's behaviour, unchanged.
- Extensionless files (`Makefile`, `Dockerfile`): routed to the directory renderer today; unchanged.

- Deferring the highlight swap while a selection is active: the swap happens once, milliseconds after first paint; not worth the code.

## Open design questions

none

## Knowledge audits

None: no agent-facing concept.

## What will hold this after it ships

Unit tests (`.test.ts`, `t.check`) for `languageForPath` and the size limit (pure functions). A FileView render test that a `.ts` path renders on the card surface and an embedded one does not. Browser verification in two themes for the visual result.

## Implementation order

1. Track 1 (surface) + test. Commit.
2. Dependency add (lockfile check). `languageForPath` + test. Commit.
3. `CodeText`, highlighter chunk, stylesheet; wire into plaintext renderer. Measure chunk size. Commit.
4. Browser check (`.ts`, `.py`, `.txt`, large file; two themes), exhibit, what's-new line. Commit.

## Rollout shape

Done when: the tests above pass, `pnpm typecheck` and `pnpm layout-check` pass, and the browser check shows the card and colours in two themes. No data migration.

## Review log

Round 1 (codex gpt-6.2-sol): accepted size gate on startup + cold open, properties-face label, `.attach` exclusion, failure/stale handling, `<code>` placement, character-unit limit timed on `.ts`, contrast check. Rejected cutting highlighting from scope (authorized by the developer); it lands as a second commit.

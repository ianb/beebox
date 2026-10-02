---
title: "Markdown cards: `<br>` renders as literal text, hard breaks fail in the app, and agents have no description of our Markdown dialect"
workstream: markdown-expressiveness
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report
---

The boxholder cannot put a line break inside a paragraph of a Markdown card.

- A single newline renders as a space. This is correct and stays: agents
  often wrap prose with newlines, and those must not become breaks.
- `<br>` and `<br />` render as literal text.
- Two trailing spaces before a newline do not render a break in the app.

## Findings (2026-10-02)

A plain Markdoc run with the app's tokenizer options
(`new Tokenizer({ linkify: true })`, as in
`beebox/src/frontend/src/lib/markdoc-parse.ts:31`) gives:

- `line one␠␠\nline two` → `line one<br>line two`. Markdoc produces the hard
  break. The failure is therefore elsewhere: the trailing spaces may be
  stripped on write (editor, formatter, or a box hook), or the app renderer
  may drop the `hardbreak` node. Not yet traced.
- `<br>`, `<br />`, and `<table>…</table>` all render escaped. Markdoc
  disables raw HTML completely, so no HTML works in cards, tables included.

## Wanted

1. `<br>` and `<br />` render as a line break. Markdoc has no raw HTML, so this
   needs explicit support (a tokenizer/transform rule for the `br` tag only, or
   a Markdoc tag such as `{% br /%}`). Support only `br`. Do not enable HTML in
   general.
2. Trailing-two-space hard breaks work end to end, or the docs say they do not.
   Agents can produce them, but humans editing a card cannot see them.
3. A short "our Markdown" reference for box agents: how the dialect differs
   from GitHub Flavored Markdown. At minimum it covers line breaks, raw HTML
   (none, except `br`), tables (pipe tables only), autolinks, Markdoc tags, and
   any box-specific syntax (card refs, figures, source citations). It goes in
   the box agent's loaded guidance with a one-line pointer, per the
   bbx-context skill. Run a knowledge audit after the change.

## Review: HTML policy

Decide the HTML policy deliberately and record it in the reference above.
Today it is "no HTML at all" by Markdoc default, not by decision. Questions:

- Should HTML tables be allowed? Pipe tables cannot hold multi-line cells or
  merged cells; HTML tables can, but they need sanitizing.
- Is an allow-list of tags (for example `br`, `sub`, `sup`, `kbd`, `details`)
  worth its sanitizer and security-review cost?
- The published-site renderer (`beebox/src/publish/draft/render-docs.ts`) uses
  the same Markdoc config and must follow the same policy. The
  `static-markdown-publish` workstream
  ([static-publications-render-markdown](../features/2026-10-02-static-publications-render-markdown.md))
  depends on this.

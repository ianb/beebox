---
title: "pandoc templates markdoc transcoding"
workstream: unknown
needs: [design]
area: beebox
resolution: wontfix
---

**Closed (2026-07-14): wontfix.** No export need has materialized — exactly the
"sits unused for months" outcome the issue's own second open question predicted
("file it but don't build it until a real export need shows up; honest answer
probably the latter"). A Markdoc→Pandoc transcoder is a heavy build (the `pandoc`
binary as a runtime dep + a per-tag transformer/fallback for every custom Markdoc
tag) for a purely hypothetical printable-PDF/slides sink. Markdoc stays the
authoring + rendering layer. If a concrete export target appears, refile with that
target as the driver.

[pandoc-templates.org](https://pandoc-templates.org/) is a curated
collection of typography-conscious Pandoc templates — academic papers,
letters, slides, books — the kind of output Markdown ecosystems
historically struggle to produce. The templates are mature, opinionated,
and tuned for real print/PDF/HTML output.

Switching to Pandoc directly probably isn't worth it: we just put in the
work to standardize on Markdoc (typed body tags, JSX-ish components,
schema-validated frontmatter), and that buys us things Pandoc doesn't
(component-level rendering, structured AST traversal, the same body
model the rest of the system uses). Throwing it out to chase
template aesthetics would be a net loss.

The interesting angle is **transcoding**: ship a Markdoc → Pandoc
transformer for the cases where the output medium genuinely needs
Pandoc's template engine (a printable brief, an exportable PDF, a
slide deck from a guide card). Markdoc stays the authoring + rendering
layer; Pandoc becomes a downstream sink for specific export targets.
The transcoder would be a `bbx` subcommand (e.g. `bbx export pandoc
<card>`) that walks the Markdoc AST and emits Pandoc-flavored Markdown
or directly the Pandoc JSON AST, then pipes through `pandoc` with one
of these templates selected by export target.

Open questions:
- Which Markdoc components have lossy/lossless Pandoc equivalents?
  Custom Markdoc tags will need either a stripped/textual fallback
  or a per-tag transformer.
- Does anything in the box ecosystem actually need this today, or is
  it a "nice when we want a real PDF" capability that sits unused
  for months? (Honest answer probably the latter — file it but don't
  build it until a real export need shows up.)
- Pandoc adds a runtime dep (the `pandoc` binary). Deploy script
  already installs imagemagick; pandoc would be the same shape of
  add. Cheap.

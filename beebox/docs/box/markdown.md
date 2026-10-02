---
read-when: Writing a card body that needs more than plain prose — a line break inside a paragraph, raw HTML, a table with merged or multi-line cells, a footnote, or a literal `{%`.
---

# Markdown in card bodies

A card body is GitHub Flavored Markdown (GFM) with the differences below. The
same rules apply to chat messages and to Markdown pages a publication renders.
The box's own tags (`{% quote %}`, `{% source %}`, `{% todo %}`, and the rest)
are documented with their features; this page covers the Markdown around them.

## Line breaks

A single newline joins two lines with a space, as in GFM. You can hard-wrap
prose freely.

To break a line inside a paragraph, end it with a backslash, or write `<br>`:

```markdown
14 Elm Street\
Springfield

Monday<br>Tuesday
```

Two trailing spaces also make a break, but they are invisible and editors
often strip them. Use the backslash.

## Raw HTML

HTML works for the elements in this list. Other tags show as literal text, so
`<name>`-style placeholders in prose are safe.

| Use | Elements |
|---|---|
| Inline | `br`, `sub`, `sup`, `kbd`, `mark`, `ins`, `del`, `s`, `u`, `b`, `i`, `strong`, `em`, `code`, `small`, `abbr`, `q`, `cite`, `dfn`, `var`, `samp`, `span`, `ruby`, `rt`, `rp`, `wbr` |
| Block | `p`, `div`, `blockquote`, `hr`, `h1`–`h6`, `details`, `summary`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td` |
| Links and images | `a` with `href`, `img` with `src`, `alt`, `title`, `width` |

- Attributes: `title`, `lang` and `dir` on any element; `align` on blocks
  and table parts; `colspan` and `rowspan` on cells; `open` on
  `details`; `start`, `reversed` and `type` on `ol`. Other attributes
  (`style`, `class`, `id`, `onclick`, …) are dropped, and `bbx validate`
  warns about them.
- `<a href>` and `<img src>` work like Markdown links and images: box paths
  resolve, and `bbx mv` updates them. `<img width="200">` is the only way to
  size an image.
- An inline tag with no closing tag in its paragraph shows as literal text.
- A block element must start its own block: put it on a line by itself, after
  a blank line. Markdown inside a block element renders.
- `<!-- comments -->` render as nothing.

```markdown
<details>
<summary>Full itinerary</summary>

Day 1: **arrive** at noon.

</details>
```

## Tables

Pipe tables work as in GFM, including alignment and `\|` for a literal pipe.
A pipe-table cell holds one line. For a cell with line breaks or a merged
cell, write an HTML table; Markdown inside its cells renders:

```markdown
<table>
<tr><th colspan="2">Q3</th></tr>
<tr><td>July<br>August</td><td>**Closed**</td></tr>
</table>
```

## Footnotes

```markdown
The bridge opened in 1932.[^date]

[^date]: City records, volume 4.
```

Footnotes are numbered in order of first reference and listed at the end of
the body.

## Links

- Box paths start with `/` (see the agent guide's refs rule).
- A bare URL with a scheme (`https://…`) becomes a link. A bare `www.…` or
  `name.md` does not. Published pages do not autolink bare URLs.

## Markdoc syntax

`{%` always starts a tag, even in prose. To show one literally, put it in
backticks or write `\{%`.

Tags also run inside fenced code blocks. To show `{% … %}` in a code block (a
Liquid or Jinja template, or an example tag), add `{% process=false %}` to the
fence's first line:

````markdown
```liquid {% process=false %}
{% if user %}Hello{% endif %}
```
````

## Not supported

- Headings underlined with `===` or `---`. Use `#`.
- Code indented by four spaces. Use a fenced block.
- `~one tilde~`. Use `~~two~~`.
- `==highlight==`, `:emoji:` shortcodes, and math. Use `<mark>` for a
  highlight and the emoji character itself.

## Text from outside the box

Connectors escape the HTML and Markdoc tags in the outside text they write
(clipped pages, PDF text, form submissions), so it shows as literal text.
When you copy outside text into a card yourself, keep it literal in the same
way: escape `<` and `{%` with a backslash, or put the text in a code block.

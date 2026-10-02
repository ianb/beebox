# Raw HTML in Markdown bodies

Card bodies accept raw HTML from an allow-list. The shared parser
(`src/shared/markdoc-config/parse/core.ts`) turns markdown-it's HTML recognition on
and rebuilds every fragment as a Markdoc node, so raw HTML text never reaches a
renderer: React and Markdoc's HTML renderer only see allowed element names and
filtered attribute values.

Tested headlessly through Markdoc's own `renderers.html`, the renderer the
publish path uses.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";
import { parseMarkdown } from "../../src/shared/markdoc-config/parse/core.js";

const { transform, renderers, validate } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parseMarkdown(src), markdocConfig));
}

function warnings(src: string): string[] {
  return validate(parseMarkdown(src), markdocConfig).map((e) => e.error.message);
}
```

## Line breaks and inline elements

`<br>` in any spelling is a line break. A single newline still joins lines
with a space, so hard-wrapped prose is unaffected.

```ts
render("a<br>b <br/> c<BR />d\nsame paragraph")
=> <article><p>a<br>b <br> c<br>d same paragraph</p></article>

render("H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, <mark>hit</mark>")
=> <article><p>H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>+<kbd>C</kbd>, <mark>hit</mark></p></article>
```

Markdown inside an inline element still renders, and an element closes where
its Markdown container closes:

```ts
render("**bold <sub>sub</sub>** text")
=> <article><p><strong>bold <sub>sub</sub></strong> text</p></article>
```

## Placeholders stay text

An unlisted tag renders as literal text with no warning: `<name>`-style
placeholders in prose are common. An allowed inline tag with no close tag in
its paragraph also stays literal, since `<var>` alone is more likely a
placeholder than markup meant to run to the end of the paragraph.

```ts
render("Run bbx open <name> then set <var> to 3")
=> <article><p>Run bbx open &lt;name&gt; then set &lt;var&gt; to 3</p></article>

warnings("Run bbx open <name> then set <var> to 3")
=> []
```

## Blocks: details, tables, alignment

A block element starts its own block. Markdown between block tags renders,
including blank-line-separated paragraphs inside `<details>`:

```ts
render("<details><summary>More</summary>\n\nhidden **bold**\n\n</details>")
=> <article><details><summary>More</summary><p>hidden <strong>bold</strong></p></details></article>

render("<details open>\n<summary>S</summary>\n\nbody\n</details>")
=> <article><details open="true"><summary>S</summary><p>body</p></details></article>
```

HTML tables can merge cells and hold line breaks, which pipe tables cannot.
Omitted `</td>` and `</tr>` close the way a browser closes them, and rows
written directly in a table get the `<tbody>` a browser would add:

```ts
render('<table>\n<tr><th colspan="2">H</th></tr>\n<tr><td>a **b**</td><td>c<br>d</td></tr>\n</table>')
=> <article><table><tbody><tr><th colspan="2">H</th></tr><tr><td>a <strong>b</strong></td><td>c<br>d</td></tr></tbody></table></article>

render("<table><tr><td>1<td>2<tr><td>3</table>")
=> <article><table><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></tbody></table></article>
```

A block tag in the middle of a paragraph is text, with a warning that says why:

```ts
render("para with <div>inline div</div>")
=> <article><p>para with &lt;div&gt;inline div&lt;/div&gt;</p></article>

warnings("para with <div>inline div</div>")
=> ["<div> must start its own block (a line by itself, after a blank line); shown as text"]
```

## Links and images become Markdown links and images

`<a href>` and `<img src>` become the same nodes as `[text](url)` and
`![alt](src)`, so they get the same URL checks, in-box routing and image
handling. An `<img width>` keeps its width; Markdown image syntax has no way to
size an image.

```ts
render('<a href="https://example.com" title="t">x <b>y</b></a>')
=> <article><p><a href="https://example.com" title="t">x <b>y</b></a></p></article>

render('<p align="center"><img src="attach/logo.png" alt="Logo" width="120"></p>')
=> <article><p align="center"><img src="attach/logo.png" alt="Logo" width="120"></p></article>
```

## Comments

HTML comments render as nothing, inline or as a block:

```ts
render("before <!-- note --> after\n\n<!-- block\nnote -->\n\ntail")
=> <article><p>before  after</p><p>tail</p></article>
```

## What never renders

Scripts, frames, event handlers, styles and `javascript:` URLs never reach the
output. Disallowed elements are text; disallowed attributes are dropped with a
warning.

```ts
render("<script>alert(1)</script>")
=> <article><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></article>

render('<iframe src="https://example.com"></iframe>')
=> <article><p>&lt;iframe src=&quot;https://example.com&quot;&gt;&lt;/iframe&gt;</p></article>

render('<span style="color:red" onclick="steal()">urgent</span>')
=> <article><p><span>urgent</span></p></article>

warnings('<span style="color:red" onclick="steal()">urgent</span>')
=> ["<span>: attributes style, onclick not supported; dropped"]

render('<a href="javascript:alert(1)">x</a>')
=> <article><p>&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;</p></article>

render('<img src="x.png" onerror="steal()">')
=> <article><p><img src="x.png" alt=""></p></article>

render('<img src="javascript:steal()">')
=> <article><p>&lt;img src=&quot;javascript:steal()&quot;&gt;</p></article>
```

Attribute values are decoded once and escaped on output, so a quote in a value
cannot break out of the attribute:

```ts
render('<abbr title="&quot;&gt;<script>">A</abbr>')
=> <article><p><abbr title="&quot;&gt;&lt;script&gt;">A</abbr></p></article>
```

An author can write the internal `html` tag by hand, but the element still has
to be on the allow-list; anything else renders only its children:

```ts
render('{% html element="script" %}x{% /html %} {% html element="sub" %}ok{% /html %}')
=> <article><p>x <sub>ok</sub></p></article>
```

## Code stays literal

HTML inside code spans and fenced code is never interpreted:

```ts
render("use `<br>` in code\n\n```\n<script>x</script>\n```")
=> <article><p>use <code>&lt;br&gt;</code> in code</p><pre>&lt;script&gt;x&lt;/script&gt;
</pre></article>
```

# Markdoc.format Investigation

## Summary

`Markdoc.format()` is **safe for our actual use cases** — namely move-time
ref rewrites and AST-based migration tooling on card bodies. All of our
vocabulary (`{% quote %}`, `{% source ref=... %}`, `{% task done=true /%}`)
round-trips identically, attributes preserve order and types, and ref
values (`"/box/path.memo.card"`, `"people/dana"`) are emitted unchanged
without path normalization. Where the formatter is lossy, it's on
CommonMark cosmetics nobody on our team writes by hand (Setext headings,
ordered-list numbering, table column-padding, hr style). The handful of
cases that look semantically lossy (blockquote `>` markers on
continuation lines, reference-style links) actually re-parse to the same
AST — they're rewritten to an equivalent surface form. **One real
caveat:** the formatter is not idempotent at the byte level on first
pass for arbitrary input, but it *is* idempotent on second pass (every
case tested is stable: `format(parse(format(parse(x)))) === format(parse(x))`).

## Methodology

Probe scripts (`markdoc-format-probe.mjs`, `markdoc-format-probe2.mjs`,
both deleted after run) ran ~70 inputs through `parse → format`, compared
strings, and for suspicious cases also walked the AST of the reformatted
output to confirm semantic equivalence. Probes lived under `callback-box/`
to resolve `@markdoc/markdoc` from the workspace.

`format` is exported on the default object (same CJS workaround as `parse`):

```ts
import Markdoc from "@markdoc/markdoc";
const { parse, format } = Markdoc;
```

`format(node)` returns a `string`. Confirmed.

## Findings by category

### Vocabulary (our tags)
All clean. `quote` inline + block, `source` inline + block, nested
`source > quote`, attributes (`from="people/dana"`, `ref="/box/x.card"`,
`as="verbatim"`), and self-closing `{% task done=true /%}` all
round-trip byte-identical.

### Attribute serialization
All clean. Order preserved, types preserved, special characters in
string values (`"has \"quotes\" and 50% and [brackets]"`) round-trip
verbatim, long strings unchanged, path-like values not normalized.

### Whitespace (lossy but benign)
- **Multiple blank lines collapse** to one: `"a\n\n\n\nb"` → `"a\n\nb"`.
- **Trailing line whitespace stripped**: `"text.   \n"` → `"text.\n"`.
- **Leading paragraph indent stripped**: `"   text"` → `"text"`.
- **Trailing newline added** when missing: `"text"` → `"text\n"`.
- All semantically equivalent in CommonMark; matters only if a tool
  is doing exact-text diffs.

### CommonMark — clean
ATX headings, all three bullet markers (`-`/`*`/`+`), bold/italic in
both flavors, code fences (with language hint), inline code, inline
links, autolinks, images, hr with `---`, hard breaks (both `  \n` and
`\\\n` normalize to `\\\n`), HTML inline + block, frontmatter,
annotations on headings.

### CommonMark — lossy (cosmetic)
- **Setext heading → ATX-like + hr**: `"Heading\n---\n"` becomes
  `"Heading\n\n---\n"` — i.e. the formatter loses the heading and
  emits paragraph + hr. **This is a real semantic loss** for Setext
  H2 specifically (since `---` is ambiguous with hr). H1 (`===`) was
  not retested but likely same shape. *Verdict: matters only if cards
  use Setext, which they don't.* But worth knowing.
- **Ordered lists renumbered to all-`1.`**:
  `"1. a\n2. b\n3. c"` → `"1. a\n1. b\n1. c"`. CommonMark-valid (renders
  identically) but uglier. Original numbering is lost — including
  intentional start-at-N (`"5. a\n6. b"` → `"1. a\n1. b"`).
  *Verdict: matters if any tooling depends on visible numbers.*
- **GFM table normalization**: column alignment markers (`:--`, `:-:`,
  `--:`) dropped; column padding stripped; separator collapsed to
  `| - | - |`. **Alignment is genuinely lost** — not recoverable from
  the AST output. *Verdict: matters for any card that uses aligned
  tables.* Nothing in our vocabulary needs this, but flag it for
  briefings.
- **Reference-style links inlined**:
  `"[text][ref]\n\n[ref]: url"` → `"[text](url)\n"`. Definition removed,
  link inlined. Semantically equivalent at render time, but loses the
  authoring choice. *Verdict: fine for our use.*
- **`***` hr normalized to `---`**. Cosmetic.

### Blockquotes (cosmetically alarming, semantically fine)
Input `"> a\n> b\n> c\n"` formats to `"> a\nb\nc\n"` — only the first
line keeps the `>` marker. **Walked the AST of the reformatted output**:
all three lines remain inside a single `blockquote > paragraph`,
because CommonMark **lazy continuation** lets unmarked lines stay in
the blockquote. So this is wire-format-equivalent. *Verdict: works
correctly, but a human reading the output will think it's broken.*

### Markdoc-specific
- `{% comment %}` round-trips clean.
- Variables (`$name`) round-trip clean (we don't use them).
- Heading annotations `# H {% #id .class x=1 %}` round-trip exactly.

### Edge cases
- **Empty-body tag becomes self-closing**: `{% quote %}{% /quote %}` →
  `{% quote /%}`. Semantically equivalent if your schema accepts both
  forms (Markdoc's transformer treats them as equivalent for tags
  defined with no required content). *Worth confirming our `quote`
  schema is happy with `{% quote /%}`, though we'd never emit one.*
- **Trailing newline added** if missing at EOF.
- **Tag in list item**, **tag in blockquote**, **adjacent inline
  tags**, **code fence with literal tag text** — all clean.

### Ref attribute round-trip
All clean. No path normalization. Trailing slashes, double slashes,
relative `./sibling.card` — all preserved verbatim. This is the most
important finding for Track 4.

## Verdict for our specific use cases

### Move-time ref rewrite

**Format-based path is safer and not meaningfully messier.**

The current substring-`replaceAll` approach is fragile: it can hit
matches inside a code fence, inside an attribute value of a different
attribute, inside a string literal that happens to spell out the ref,
or miss a match because the source uses slightly different quoting.
`parse → mutate node.attributes.ref → format` is:

- structurally correct (only touches actual `ref` attributes on tag
  nodes — same walker shape as `body-refs.ts` already uses),
- benign in its side effects (the lossy normalizations above are all
  whitespace / ordered-list-numbering / table-padding — irrelevant for
  the cards we generate),
- preserves the exact value being written (no path normalization,
  no quote-style mangling).

The diff a user sees on the rewritten file may include incidental
whitespace cleanups (collapsed blank lines, stripped trailing space),
which is a minor regression vs. the surgical substring approach — but
in practice card bodies are tool-written and won't have those.

Recommend switching, with one mitigation: **on rewrite, only write
the file back if a ref actually changed**. Don't reformat-as-a-side-
effect on cards that didn't need a rewrite.

### Future briefing/recipe migration tooling

**Fidelity is acceptable.** For wholesale schema migrations
(frontmatter field → body tag, etc.), the cosmetic normalizations are
fine and arguably desirable (canonical form). The two real watchouts:

- If any existing card uses **GFM aligned tables**, alignment is lost.
  Audit before running a migration.
- If any existing card uses **Setext H2**, it becomes a paragraph + hr
  (potentially renders differently). Audit before running a migration.
- **Setext H1** likely has the same issue but wasn't directly tested.

Recommendation: before a body-touching migration, grep the box for
`^[^|\n]+\n[=:-]{3,}$` and `^\|.*:.*\|` patterns and flag any matches
for manual review.

### Other notes

- `format` returns `string` (not a stream / tree). Direct, no surprises.
- The formatter is idempotent on second pass — every test case
  satisfied `format(parse(out)) === out`. Useful invariant for tests:
  any migration tool can assert "applying twice == applying once".
- No exceptions thrown on any input; broken-Markdoc inputs become
  whatever the parser produces (the existing swallow-and-continue
  pattern in `body-refs.ts` is the right shape for the rewriter too).
- No need to reach for `prettier-plugin-markdoc` or alternatives for
  the use cases in scope. The built-in formatter is sufficient.

## Exhaustive Normalization Catalog

Every change `format(parse(x)) !== x` found in extended probing. Each
entry is a concrete before/after with strings JSON-encoded so
whitespace is visible. Cases where the output is identical are
collected at the end of each subsection (and in the final roll-up).

Caveat from the earlier report ("idempotent on second pass") **does
not hold for every input** — see the new "Non-idempotent / non-
converging" subsection at the bottom for cases where running `format`
twice produces a different result than running it once, and one case
where it never converges.

### Whitespace

- Before: `"a\n\n\n\nb"` → After: `"a\n\nb\n"` — multiple blank lines collapse to one (also adds trailing newline).
- Before: `"text.   \n"` → After: `"text.\n"` — trailing line spaces stripped.
- Before: `"   text"` → After: `"text\n"` — leading paragraph indent stripped; trailing newline added.
- Before: `"text"` → After: `"text\n"` — trailing newline added when missing.
- Before: `"\n"` → After: `""` — a lone newline becomes empty string.
- Before: `"   \n\n  "` → After: `""` — whitespace-only input collapses to empty.
- Before: `"a"` → After: `"a\n"` — single character gets a trailing newline.
- Before: `"a\n\n\n\n"` → After: `"a\n"` — many trailing newlines collapse to one.
- Before: `"\ttext"` → After: `"text\n"` — leading tab stripped.
- Before: `"﻿text"` → After: `"text\n"` — BOM stripped.
- Before: `"a b"` (non-breaking space) → After: `"a&nbsp;b\n"` — **NBSP is converted to an HTML entity** (only visible Unicode normalization observed).

Identical in this category: empty string `""` → `""`.

### Emphasis & strong

**Every emphasis/strong flavor tested round-trips identically** — including `**bold**`, `__bold__`, `*em*`, `_em_`, `***both***`, `___both___`, `*__mixed__*`, `_**mixed**_`, GFM strikethrough `~~text~~`, nested star `**a *b* c**`, nested underscore `_a __b__ c_`, and `**a _b_ c**`. No marker-style normalization observed.

### Bullet markers

- Before: `"- a\n* b\n+ c\n"` → After: `"- a\n\n* b\n\n+ c\n"` — mixed markers in adjacent lines parse as **three separate lists**, separated by blank lines on emission (not unified to one marker; the blank lines are added).
- Before: `"- a\n    - b\n"` → After: `"- a\n  - b\n"` — 4-space nested indent normalized to 2-space.
- Before: `"- a\n\t- b\n"` → After: `"- a\n  - b\n"` — tab-indented nested item normalized to 2-space.

Identical: `- a\n- b\n- c`, `* a\n* b\n* c`, `+ a\n+ b\n+ c` (all three markers preserved when consistent), 2-space nested indent, deeply nested 3-level lists.

### Code fences

- Before: `` "````\ncode\n````\n" `` → After: `` "```\ncode\n```\n" `` — 4-backtick fence normalized to 3 backticks.
- Before: 5-backtick fence → 3-backtick fence (same as above).
- Before: `"~~~\ncode\n~~~\n"` → After: `` "```\ncode\n```\n" `` — **tilde fences normalized to backtick fences**.
- Before: `"~~~~\ncode\n~~~~\n"` → After: 3-backtick fence — both length and style normalized.
- Before: `` "```ts setup\nx\n```\n" `` → After: `` "```ts\nx\n```\n" `` — **info-string args after the language are dropped**. Only the first token (language) is preserved.
- Before: `` "```js {1,3-5}\nx\n```\n" `` → After: `` "```js\nx\n```\n" `` — same: highlight-line spec stripped.
- Before: `` "```\n```\n" `` → After: `` "```\n\n```\n" `` — empty fence gets a blank line inserted between the open/close.
- Before: `"  ```\n  code\n  ```\n"` (2-space-indented fence) → After: flush-left fence — indent removed.
- Before: `` "````\n```\n````\n" `` (4-tick fence wrapping a 3-tick content line) — round-trips identically. The formatter *does* widen to 4 ticks when content requires it. (Compare with the "4 backticks" case above: when no inner backticks force widening, it shrinks back to 3.)

Identical: 3-backtick fence, language hints (`js`, `ts`, `python`), fence with internal blank line.

### Code spans

- Before: `` "`` code with ` inside ``\n" `` → After: `` "`code with ` inside`\n" `` — **double-backtick span normalized to single backtick**, *even when the content contains a literal backtick* → the literal backtick is now ambiguous and the output **does not re-parse to the same AST**. Second pass yields `` "`code with` inside`\n" `` (idempotence broken).
- Before: `` "``` co ` de ```\n" `` → After: `` "`co ` de`\n" `` — same shape: triple-tick inline span normalized to single, content corrupted by ambiguity. Not idempotent.
- Before: `` "` x `\n" `` → After: `` "`x`\n" `` — **leading/trailing space inside a code span is stripped**. (CommonMark uses single leading/trailing space as a delimiter, so this is per-spec, but it *is* a textual change.)

Identical: simple `` `code` ``.

### Links

- Before: `[text](url 'title')` → After: `[text](url "title")` — single-quoted titles normalized to double-quoted.
- Before: `[text](url (title))` → After: `[text](url "title")` — paren-style title normalized to double-quoted.
- Before: `[text](url 'with "quotes"')` → After: `[text](url "with "quotes"")` — **double quotes inside titles are not escaped** when normalizing to double-quoted form. The output re-parses but the title text now reads as `with ` + dangling `quotes"`. Confirm what your renderer does with this.
- Before: `<a@b.com>` → After: `[a@b.com](mailto:a@b.com)` — **email autolinks rewritten to inline links with `mailto:` prefix**.
- Before: `[text][ref]\n\n[ref]: url` → After: `[text](url)` — full reference-style link inlined; definition removed.
- Before: `[ref][]\n\n[ref]: url` → After: `[ref](url)` — collapsed reference inlined.
- Before: `[ref]\n\n[ref]: url` → After: `[ref](url)` — shortcut reference inlined.
- Before: `[text][ref]\n\n[ref]: url "title"` → After: `[text](url "title")` — title preserved when inlining reference link.

Identical: inline `[text](url)`, inline with double-quoted title, URL autolink `<https://example.com>`, bare URL `https://example.com`, link text inside a code span (left alone).

### Images

- Before: `![alt][ref]\n\n[ref]: url` → After: `![alt](url)` — reference-style image inlined (same as links).

Identical: `![alt](url)`, `![alt](url "title")`, `![](url)` (empty alt), image inside link `[![alt](img)](url)`.

### Headings

- Before: `"# H1 #\n"` → After: `"# H1\n"` — **ATX closing hashes are stripped** (h1).
- Before: `"## H2 ##\n"` → After: `"## H2\n"` — same for h2.
- Before: `"H2\n---\n"` → After: `"H2\n\n---\n"` — **Setext H2 is lost**: becomes paragraph "H2" + hr. (Confirmed in the earlier section; restated here for completeness.)

Identical (corrections to the earlier report): Setext H1 with short `===` and Setext H1 with long `========` **both round-trip exactly** — only Setext H2 is broken, because `---` collides with hr. ATX h1–h6 all round-trip. Heading inside list item, heading with annotation `{% #id %}`, heading with multiple annotations `{% #id .cls x=1 %}` — all identical.

### Hard / soft breaks

- Before: `"a  \nb\n"` → After: `"a\\\nb\n"` — two-space hard break normalized to backslash hard break.

Identical: backslash hard break, plain soft break.

### Blockquotes

- Before: `"> a\n> b\n> c\n"` → After: `"> a\nb\nc\n"` — only first line keeps `>` (relies on lazy continuation). Restated; semantically equivalent at parse time.
- Before: `">> deep\n"` → After: `"> > deep\n"` — **`>>` stacked markers always get spaces inserted**: `>` followed by space then `>`.
- Before: `"> a\n>> b\n> c\n"` → After: `"> a\n> \n> > b\nc\n"` — mixed nesting: an extra `> ` blank line is **inserted** between the outer and nested quote, and the final `> c` loses its marker (lazy continuation).
- Before: `"> - a\n> - b\n"` → After: `"> - a\n- b\n"` — list inside blockquote loses the second `>`. **Lazy continuation does NOT preserve the list-in-blockquote here**: second pass yields `"> - a\n\n- b\n"` (blank line introduced), meaning the AST has changed shape — the second `- b` now parses as a top-level list item, not part of the blockquote. **Semantic loss.**
- Before: `"> ```\n> code\n> ```\n"` → After: `` "> ```\ncode\n```\n" `` — code fence inside blockquote loses inner `>`. **Worse than the previous case**: this output is **not idempotent and does not converge**. Pass 2: `` "> ```\n\n```\n\ncode\n\n```\n\n```\n" `` — fences explode. Pass 3, 4, 5: each adds another pair of fences. (See "Non-idempotent / non-converging" below.) **Real bug.**
- Before: `"> a\n>\n> b\n"` → After: `"> a\n> \n> b\n"` — empty blockquote line gets a trailing space inserted (`>` becomes `> `).

Identical: lazy continuation form `> a\nb\n`, heading inside blockquote `> # H\n`.

### Horizontal rules

- Before: `"***\n"` → After: `"---\n"` — star hr normalized to dash.
- Before: `"___\n"` → After: `"---\n"` — underscore hr normalized to dash.
- Before: `"- - -\n"` → After: `"---\n"` — spaced dashes normalized.
- Before: `"* * *\n"` → After: `"---\n"` — spaced stars normalized.
- Before: `"----\n"` → After: `"---\n"` — four dashes shortened to three.
- Before: `"--------\n"` → After: `"---\n"` — eight dashes shortened to three.

Identical: canonical `---`.

### Lists (deeper)

- Before: `"1. a\n2. b\n3. c\n"` → After: `"1. a\n1. b\n1. c\n"` — ordered list renumbered to all-`1.`.
- Before: `"5. a\n6. b\n"` → After: `"5. a\n1. b\n"` — start-at-N preserved on the *first* item only; remaining items become `1.`.
- Before: `"1) a\n2) b\n"` → After: `"1) a\n1) b\n"` — paren-style ordered marker preserved, but renumbered to all-`1)`.
- Before: `"1. a\n- b\n"` → After: `"1. a\n\n- b\n"` — adjacent ordered + unordered are split with a blank line (same shape as mixed bullet markers).

Identical: tight bullets, loose bullets (blank lines preserved), list item paragraph continuation `- a\n\n  b\n`, **task lists round-trip exactly** including `- [ ] todo`, `- [x] done`, **and** uppercase `- [X] done` (case preserved).

### Tables

- Before:
  ```
  | a | b |
  |---|---|
  | 1 | 2 |
  ```
  → After:
  ```
  | a | b |
  | - | - |
  | 1 | 2 |
  ```
  — separator collapsed to single `-`.
- Before: aligned `|:--|:-:|--:|` → After: `| - | - | - |` — **all alignment markers lost**.
- Before: `| a |b| c |` (tight padding) → After: `| a | b | c |` — padding normalized (single space).
- Before: cells with inline formatting (`**a**`, `` `b` ``) → After: **the column widths are right-padded with spaces** so all cells in a column align visually. Example: separator becomes `| ----- | --- |` and cells gain trailing spaces (`| 1     | 2   |`). This is a **content-character-level change** introducing trailing whitespace inside cells.
- Before: single column → separator collapsed to `| - |`.

### HTML

- Before: `"&amp;\n"` → After: `"&\n"` — **named entities decoded to their character**. The entity is gone from the source.
- Before: `"&copy;\n"` → After: `"©\n"` — same; `&copy;` decoded.
- Before: `"&#39;\n"` → After: `"'\n"` — numeric entity decoded.
- Before: `"&#x27;\n"` → After: `"'\n"` — hex entity decoded.

Identical: inline `<span>x</span>`, `<br>`, `<br/>`, `<br />`, block `<div>x</div>`, HTML comment `<!-- comment -->`.

### Escapes

- Before: `"\\*not italic\\*\n"` → After: `"\\*not italic*\n"` — **trailing escape lost**: `\*` at end becomes bare `*`. (Leading `\*` preserved because the `*` is ambiguous there; trailing position is not, so the escape is "unnecessary" and dropped.)
- Before: `"\\[not link\\]\n"` → After: `"[not link]\n"` — **both escapes dropped**. Output re-parses as a paragraph "[not link]" (not a link, since no `(url)` follows), so semantically equivalent, but the textual escape is gone.
- Before: `"\\\\\n"` → After: `"\\\n"` — **double backslash collapses to single**. This is semantically wrong: the input represents a literal backslash; the output is a hard-break marker. (Though in this isolated context they render the same, it's a different AST.)
- Before: `"\\ \n"` → After: `"\\\n"` — backslash-space becomes backslash-only (trailing whitespace stripped, leaving what looks like a hard-break marker).

Identical: `\a` (backslash before ordinary char), `text\` at end of line.

### Frontmatter

- Before: `"---\nkey: value\n---\nbody\n"` → After: `"---\nkey: value\n---\n\nbody\n"` — **a blank line is inserted between the frontmatter closing `---` and the body**. This happens for every frontmatter input that has a body.
- Before: `"---\n---\nbody\n"` → After: `"body\n"` — **empty frontmatter is dropped entirely**.
- Before: TOML `+++\nkey = "value"\n+++\nbody\n` — **identical**. TOML frontmatter is treated as part of the body (the parser doesn't recognize it as frontmatter), so the `+++` lines round-trip but aren't extracted to a frontmatter node.

Identical: TOML frontmatter (only because it isn't recognized).

### Markdoc tags — **dangerous findings**

- Before: `{% tag x='y' %}\nbody\n{% /tag %}\n` → After: `"body\n\n{% tag /%}\n"` — **single-quoted attributes silently lose the attribute, the tag becomes self-closing, and the body is ejected**. `parse()` reports no errors. This is the most alarming finding in the catalog: a tag-authored card with `x='y'` parses cleanly, emits something *very different*, and the user gets no diagnostic.
- Before: `{% tag x = "y" %}\nbody\n{% /tag %}\n` (spaces around `=`) → After: `"body\n\n{% tag /%}\n"` — same disaster shape: attribute lost, tag emptied, body ejected to top level. No parse error.
- Before: `{% tag x = "y" /%}\n` (spaces around `=`, self-closing) → After: `""` — **entire tag disappears**. Empty string. No parse error.

Identical (the safe forms):

- `{% tag x="y" %}body{% /tag %}` — double quoted.
- `{% tag x="y" z="w" %}` — multi-attr order preserved.
- `{% tag %}` no attrs.
- `{% tag n=42 %}`, `{% tag n=4.2 %}` — numeric attrs preserved as numbers (not quoted).
- `{% tag b=true %}`, `{% tag b=false %}` — booleans preserved.
- `{% tag n=null %}` — null preserved.
- `{% tag arr=["a", "b"] %}` — arrays preserved.
- `{% tag o={k: "v"} %}` — objects preserved.

### Markdoc tag whitespace

- Before: `"{%tag%}\nbody\n{%/tag%}\n"` → After: `"{% tag %}\nbody\n{% /tag %}\n"` — no-inner-space form normalized to canonical single-space.
- Before: `"{%  tag  x=\"y\"  %}\nbody\n{%  /tag  %}\n"` → After: canonical single-space form — extra inner spaces normalized.
- Before: `"{% tag x=\"y\"%}\nbody\n{% /tag %}\n"` (missing space before `%}`) → After: canonical `{% tag x="y" %}` — space inserted.
- Before: `"{% tag / %}\n"` (space before `/`) → After: `"{% tag /%}\n"` — **space before `/` removed**; the canonical self-close is `/%}` with no leading space.

Identical: `{% tag /%}` (canonical self-close form).

### Markdoc tag positioning

- Before: `"{% a %}body{% /a %}"` (no trailing newline) → After: `"{% a %}body{% /a %}\n"` — trailing newline added (same rule as plain text).

Identical: adjacent inline tags `{% a %}x{% /a %}{% b %}y{% /b %}`, tag at doc start, tag adjacent to inline text (`before{% a %}x{% /a %}after`), inline self-close (`before {% tag /%} after`).

### Markdoc tag content

- Before: `"{% tag %}\n{% /tag %}\n"` (empty body) → After: `"{% tag /%}\n"` — empty-body block tag normalized to self-closing. (Restated from the earlier report.)

Identical: tag with only inline whitespace `{% tag %} {% /tag %}`, tag wrapping a code span that contains literal tag syntax `` `{% inner %}` ``.

### Unicode

All Unicode tests round-trip identically: emoji `🎉`, precomposed `é` (U+00E9), decomposed `é`, zero-width joiner `‍`, RTL mark `‏`. **The only Unicode normalization observed anywhere is NBSP (` `) → `&nbsp;`** (recorded in the Whitespace section).

### Misc edge cases

- Before: `"a\n\n\n\n"` → After: `"a\n"` — trailing blank lines collapsed (already covered in Whitespace).

Identical: `"a\n"`.

### Non-idempotent / non-converging cases

The earlier report claimed `format` is idempotent on second pass for "every case tested". That claim does not hold against this wider probe. The following inputs produce **different** output on the second pass:

- Double-backtick code span with internal backtick: `` "`` code with ` inside ``\n" `` → pass 1 `` "`code with ` inside`\n" `` → pass 2 `` "`code with` inside`\n" `` (the internal-backtick boundary shifts because the content has been mis-delimited).
- Triple-backtick inline code span: same shape as above.
- List inside blockquote: `"> - a\n> - b\n"` → pass 1 `"> - a\n- b\n"` → pass 2 `"> - a\n\n- b\n"` (blank line inserted; AST shape changes: second item leaves the blockquote).
- **Code fence inside blockquote: does not converge.** `"> ```\n> code\n> ```\n"` → each pass adds an additional fence pair. Pass 1 has 2 fence markers, pass 2 has 4, pass 3 has 6, pass 4 has 8, pass 5 has 10. There is no fixed point.

This means a "format twice and compare" idempotence assertion is **not** a safe invariant across arbitrary CommonMark.

### Identical (verified, listed for completeness)

Single-line summary of constructs verified to round-trip byte-exact:

- empty string `""`: identical.
- all six emphasis/strong flavors (`**`, `__`, `*`, `_`, `***`, `___`) and nested combinations: identical.
- GFM strikethrough `~~text~~`: identical.
- bullet markers `-`, `*`, `+` when used consistently: identical.
- 2-space and 3-level nested bullet lists: identical.
- 3-backtick code fence: identical.
- code fence with language hint (`js`, `ts`, `python`): identical.
- code fence with internal blank line: identical.
- 4-backtick fence *when content forces widening* (contains ` ``` `): identical.
- single-backtick code span: identical.
- ATX headings h1–h6 (without closing hashes): identical.
- Setext H1 with `===` (any underline length): identical.
- heading annotations `{% #id .cls x=1 %}`: identical.
- inline link `[text](url)` and with double-quoted title: identical.
- URL autolink `<https://example.com>`: identical.
- bare URL `https://example.com`: identical.
- link inside code span (left alone): identical.
- inline image `![alt](url)`, with title, with empty alt, image inside link: identical.
- backslash hard break `a\\\nb`: identical.
- soft break: identical.
- blockquote with heading inside: identical.
- blockquote with lazy continuation `> a\nb`: identical.
- canonical `---` hr: identical.
- tight and loose lists: identical.
- list item with paragraph continuation: identical.
- task list items `[ ]`, `[x]`, **`[X]` (uppercase preserved)**: identical.
- HTML inline (`<span>`, `<br>`, `<br/>`, `<br />`), block (`<div>`), and comments: identical.
- backslash before ordinary char `\a`: identical.
- trailing backslash at EOL `text\`: identical.
- TOML frontmatter (not recognized as frontmatter, passes through as body): identical.
- all double-quoted Markdoc tag attribute forms (string, number, float, bool, null, array, object): identical.
- canonical single-space tag whitespace `{% tag %}` and self-close `{% tag /%}`: identical.
- adjacent inline tags, tag at doc start, tag inside inline text: identical.
- tag wrapping code span with literal tag syntax: identical.
- emoji, precomposed/decomposed accents, ZWJ, RTL marks: identical.
- single newline `a\n`: identical.


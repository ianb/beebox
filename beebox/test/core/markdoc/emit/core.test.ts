// # Markdoc emit-nodes: graceful degradation
//
// `emitNode`'s dispatch table (`src/core/markdoc/emit/nodes.ts`) enumerates all
// 28 members of Markdoc's vendor `NodeType` union. Most of this module's
// coverage comes indirectly through the other `markdoc-*.doctest.md` files and
// `briefing-compile.doctest.md`, which exercise the handled types (headings,
// lists, tags, …). This file targets the *degrading* groups specifically —
// node types the emitter doesn't have bespoke handling for, where the
// contract is "emit the children, never crash."

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { emitBodyAsMarkdown } from "../../../../src/core/markdoc/emit/core.js";

// ## A GFM table degrades to its flattened cell text
//
// Tables aren't part of the briefing/recipe vocabulary. `table`, `thead`,
// `tbody`, `tr`, `th`, and `td` all fall through to the shared "emit children"
// handler — no grid, no cell separators, just the concatenated text runs.
void test("Tables aren't part of the briefing/recipe vocabulary.", async (t) => {
  const withTable = "| a | b |\n| - | - |\n| 1 | 2 |\n\nfoo\n";
  t.check(emitBodyAsMarkdown(withTable), `ab12foo

`);
});

// ## A parse error node degrades to nothing, not a crash
//
// Markdoc's `{% /* ... */ %}` comment syntax is off by default in the config
// this emitter parses with (no `Config` is passed to `parse`), so a stray
// `{% /* ... */ %}` in a body becomes an `error` node instead of a `comment`
// node. Either way the emitter degrades the same way — emit the node's
// children (there are none) and move on; the surrounding paragraphs still
// render.
void test("Markdoc's {% / ...", async (t) => {
  const withBadTag = "foo\n\n{% /* a comment */ %}\n\nbar\n";
  t.check(emitBodyAsMarkdown(withBadTag), `foo

bar

`);
});

// ## `{% todo %}` emits a checklist-style status marker, not just the text
//
// `todo` (`markdoc/emit-tags.ts`'s universal group) is a *handled* tag, unlike
// the degrading groups above — this section pins its markdown shape since no
// other doctest exercises the backend emitter's tag dispatch for it. Absence
// of `status` is `open` (`☐`); `done`/`dropped` also strike the text.
void test("todo (markdoc/emit-tags.ts's universal group) is a handled tag, unlike the de...", async (t) => {
  t.check(emitBodyAsMarkdown("{% todo %}\n\nCall the vet\n\n{% /todo %}"), `☐ Call the vet

`);

  t.check(emitBodyAsMarkdown('{% todo status="done" %}\n\nCall the vet\n\n{% /todo %}'), `✔ ~~Call the vet~~

`);

  t.check(emitBodyAsMarkdown('{% todo status="dropped" %}\n\nCall the vet\n\n{% /todo %}'), `✘ ~~Call the vet~~ (dropped)

`);

  t.check(emitBodyAsMarkdown('{% todo status="parked" %}\n\nCall the vet\n\n{% /todo %}'), `⏸ Call the vet (parked)

`);
});

// Inline form emits with no trailing blank line, same as `quote`/`source`:
void test("Inline form emits with no trailing blank line, same as quote/source:", async (t) => {
  t.check(emitBodyAsMarkdown("Remember to {% todo %}call the vet{% /todo %} today."), `Remember to ☐ call the vet today.

`);
});

// ## `{% see-also %}` emits its text plus a `[→ ref]`-style citation
//
// Same bracketed-citation shape `source` already uses for `ref`/`href` — no
// inline/block split (`see-also` always transforms to one `SeeAlso` tag).
void test("Same bracketed-citation shape source already uses for ref/href — no inline/bl...", async (t) => {
  t.check(emitBodyAsMarkdown('{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}'), `Dana offered to pick it up [→ dana]

`);

  t.check(
    emitBodyAsMarkdown('{% see-also href="https://example.com/thread" %}the original request{% /see-also %}')
    ,
    `the original request [→ thread]

`,
  );
});

// A `todo` with a nested `see-also` emits both, the marker prefixing the
// whole accumulated block:
void test("A todo with a nested see-also emits both, the marker prefixing the whole accu...", async (t) => {
  const nested = '{% todo id="vet-refill" %}\n\nCall the vet\n\n{% see-also ref="people/dana.person.card" %}Dana offered to pick it up{% /see-also %}\n\n{% /todo %}';
  t.check(emitBodyAsMarkdown(nested), `☐ Call the vet

Dana offered to pick it up [→ dana]

`);
});

// ## `{% source %}` carries its `usage` text into the bracket citation
//
// The schema's attribute is `usage` (`shared/markdoc-config.ts`); the emitter
// read the pre-rename `as` spelling for months, silently dropping every modern
// tag's usage text from compiled output. Both spellings emit now — `usage`
// preferred, `as` kept for cards written before the rename.
void test("The schema's attribute is usage (shared/markdoc-config.ts); the emitter read...", async (t) => {
  t.check(emitBodyAsMarkdown('{% source ref="_content/recipes/stew.recipe.card" usage="verbatim" %}Browning first is the whole trick.{% /source %}'), `Browning first is the whole trick. [→ stew: verbatim]

`);

  t.check(emitBodyAsMarkdown('{% source ref="_content/recipes/stew.recipe.card" %}Browning first is the whole trick.{% /source %}'), `Browning first is the whole trick. [→ stew]

`);
});

// ## Raw HTML and footnotes go back out as written
//
// A body's allow-listed HTML reaches AGENTS.md as HTML (Claude reads it as
// written), comments disappear, and footnotes return to GFM `[^n]` syntax.
void test("A body's allow-listed HTML reaches AGENTS.md as HTML (Claude reads it as writ...", async (t) => {
  await t.checkText(emitBodyAsMarkdown("H<sub>2</sub>O<br>next <!-- hidden -->\n\n<details open>\n<summary>More</summary>\n\nbody\n\n</details>"), `H<sub>2</sub>O<br>next 
«blankline»
<details open>
<summary>
More
</summary>
«blankline»
body
«blankline»
</details>`);

  await t.checkText(emitBodyAsMarkdown("Claim[^a].\n\n[^a]: The source."), `Claim[^1].
«blankline»
[^1]: The source.`);
});

// ## A checklist item keeps its checkbox; a recipe tag falls back to its content
//
// The GFM task checkbox is a parser-produced `task` tag, emitted as it was
// written. The recipe tags belong to the recipe plugin and are undefined here, so
// a recipe tag in a body takes the unknown-tag path: the inner content stays and
// a warning goes to stderr (the warning is expected).
void test("The GFM task checkbox is a parser-produced task tag, emitted as it was written.", async (t) => {
  const warn = console.warn;
  console.warn = () => {};
  const result = [
    emitBodyAsMarkdown("- [x] done\n- [ ] later\n"),
    emitBodyAsMarkdown('{% yield amount="4" %}4 servings{% /yield %}'),
  ];
  console.warn = warn;
  t.check(result, [
    `- [x] done
- [ ] later

`,
    `4 servings

`,
  ]);
});

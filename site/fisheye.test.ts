// Unit tests for the fisheye vocabulary (Track F): the expand tag's inline and
// block renderings, nesting, and the nugget placeholder + embedNuggets
// substitution (unknown slug fails; proposed refuses even via embed). Run with
// `pnpm --dir site test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { embedNuggets, NuggetError, type Nugget } from "./nuggets.js";
import { renderBody } from "./render.js";

const RENDER = { pageSitePath: "fisheye.html", base: "/x/site/" };

function nugget(overrides: Partial<Nugget>): Nugget {
  return {
    slug: "n1",
    file: "nuggets/n1.md",
    source: "callback-box/docs/a.md",
    span: "the span text",
    status: "excerpt",
    body: "",
    spanState: "current",
    ...overrides,
  };
}

// --- expand tag ---------------------------------------------------------------

test("expand inline: button trigger + hidden=until-found span, inside the paragraph", () => {
  const { html } = renderBody("Before {% expand label=\"more\" %}hidden text{% /expand %} after.", RENDER);
  assert.match(html, /<p>Before <span class="fx">/);
  assert.match(html, /<button type="button" class="fx-t" aria-expanded="false">more<\/button>/);
  assert.match(html, /<span class="fx-b" hidden="until-found">hidden text<\/span>/);
});

test("expand block: native details/summary, no script dependency", () => {
  const { html } = renderBody("{% expand label=\"the fold\" %}\nInside.\n{% /expand %}", RENDER);
  assert.match(html, /<details class="fx"><summary>the fold<\/summary><p>Inside.<\/p><\/details>/);
});

test("expand nests: inline within inline keeps both collapsed layers in the DOM", () => {
  const { html } = renderBody(
    "A {% expand label=\"one\" %}deep {% expand label=\"two\" %}deeper{% /expand %} text{% /expand %}.",
    RENDER,
  );
  const outer = html.indexOf("\"fx-b\"");
  const inner = html.indexOf("\"fx-b\"", outer + 1);
  assert.ok(outer >= 0 && inner > outer, `expected two nested fx-b spans in: ${html}`);
  assert.match(html, /deeper/);
});

// --- nugget embedding ---------------------------------------------------------

test("nugget tag renders a placeholder; embedNuggets substitutes the rendered figure", () => {
  const { html } = renderBody("{% nugget slug=\"n1\" /%}", RENDER);
  assert.match(html, /<x-nugget slug="n1"><\/x-nugget>/);
  const embedded = embedNuggets(html, { nuggets: [nugget({})], ...RENDER });
  assert.doesNotMatch(embedded, /x-nugget/);
  assert.match(embedded, /<figure class="nugget" id="nugget-n1"/);
  assert.match(embedded, /from <code>callback-box\/docs\/a.md<\/code>/);
});

test("embedNuggets: unknown slug fails the build naming the page", () => {
  const { html } = renderBody("{% nugget slug=\"nope\" /%}", RENDER);
  assert.throws(
    () => embedNuggets(html, { nuggets: [nugget({})], ...RENDER }),
    (e: unknown) => e instanceof NuggetError && /fisheye\.html.*"nope"/.test(e.message),
  );
});

test("embedNuggets: a page embedding a proposed nugget still refuses to render it", () => {
  const { html } = renderBody("{% nugget slug=\"n1\" /%}", RENDER);
  assert.throws(
    () => embedNuggets(html, { nuggets: [nugget({ status: "proposed", body: "agent words" })], ...RENDER }),
    NuggetError,
  );
});

test("nugget tag refuses inline position — a figure cannot live mid-sentence", () => {
  assert.throws(
    () => renderBody("A sentence with {% nugget slug=\"n1\" /%} inside it.", RENDER),
    /mid-sentence/,
  );
});

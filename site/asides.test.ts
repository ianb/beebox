// Native aside-ref resolution: the author-voice boundary (a pending author
// aside publishes only the standard placeholder, never the card body), the
// empty-body and nesting refusals, unknown refs, the ref/kind conflict, and the
// malformed-tag catch. Ported from the deleted box importer's tests — the
// enforcement moved into the build, the rules did not change. Run with
// `pnpm --dir site test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AsideError, embedAsides, flatAside, PENDING_AUTHOR_PLACEHOLDER, renderAside, type AsideCard } from "./asides.js";
import { MarkupError, renderBody } from "./render.js";

const RENDER = { file: "cards/p.site-page.card", pageSitePath: "p.html", base: "/x/site/" };
const EMBED = { pageSitePath: "p.html", base: "/x/site/" };

function aside(overrides: Partial<AsideCard["fields"]>, body: string): AsideCard {
  return {
    slug: "a1",
    file: "cards/a1.site-aside.card",
    fields: { kind: "generated", label: "how it works", status: "ready", ...overrides },
    body,
  };
}

function registry(card: AsideCard): Map<string, AsideCard> {
  return new Map([[card.slug, card]]);
}

// --- the ref tag ---------------------------------------------------------------

test("aside ref renders a placeholder element, substituted by embedAsides", () => {
  const { html } = renderBody("{% aside ref=\"a1\" /%}", RENDER);
  assert.match(html, /<x-aside slug="a1"><\/x-aside>/);
  const embedded = embedAsides(html, { asides: registry(aside({}, "Machine text.")), ...EMBED });
  assert.doesNotMatch(embedded.html, /x-aside/);
  assert.match(embedded.html, /<details class="fx aside-generated">/);
});

test("a referenced aside renders identically to the inline aside tag", () => {
  const inline = renderBody("{% aside kind=\"generated\" label=\"how it works\" %}\nMachine text.\n{% /aside %}", RENDER);
  const referenced = renderAside(aside({}, "Machine text."), EMBED);
  // The inline form arrives inside the document's <article> wrapper.
  assert.equal(inline.html, `<article>${referenced.html}</article>`);
});

test("embedAsides: an unknown ref fails the build naming page and slug", () => {
  const { html } = renderBody("{% aside ref=\"nope\" /%}", RENDER);
  assert.throws(
    () => embedAsides(html, { asides: new Map(), ...EMBED }),
    (e: unknown) => e instanceof AsideError && /p\.html.*"nope"/.test(e.message),
  );
});

test("an aside ref carrying kind/label is an error — the card owns those", () => {
  assert.throws(() => renderBody("{% aside ref=\"a1\" kind=\"bee\" label=\"x\" /%}", RENDER), /also carries kind\/label/);
});

test("an aside ref mid-sentence is an error — a details cannot live inside a paragraph", () => {
  assert.throws(() => renderBody("A sentence with {% aside ref=\"a1\" /%} inside it.", RENDER), /mid-sentence/);
});

test("a malformed aside ref fails the build instead of silently vanishing", () => {
  // Markdoc's transform drops an unparseable tag without complaint; the build's
  // validation pass is what turns it into a visible failure.
  assert.throws(() => renderBody("{% aside ref = 'a1' /%}", RENDER), MarkupError);
});

// --- the author-voice boundary -------------------------------------------------

test("pending author aside publishes the placeholder, never the card body", () => {
  const card = aside({ kind: "author", status: "pending" }, "agent prose that must not ship");
  const { html } = renderAside(card, EMBED);
  assert.match(html, /This panel renders only/);
  assert.doesNotMatch(html, /agent prose/);
  assert.ok(flatAside("a1", registry(card)).includes(PENDING_AUTHOR_PLACEHOLDER));
});

test("ready author aside with an empty body is an error", () => {
  assert.throws(() => renderAside(aside({ kind: "author", status: "ready" }, ""), EMBED), /empty body/);
});

test("pending non-author aside with an empty body is still an error", () => {
  assert.throws(() => renderAside(aside({ kind: "bee", status: "pending" }, ""), EMBED), /empty body/);
});

test("an aside body referencing another aside is rejected — asides do not nest", () => {
  assert.throws(() => renderAside(aside({}, "{% aside ref=\"a1\" /%}"), EMBED), /do not nest/);
});

// --- the .md twin --------------------------------------------------------------

test("flatAside carries label and body into the flat text", () => {
  const flat = flatAside("a1", registry(aside({}, "Machine text.")));
  assert.match(flat, /how it works/);
  assert.match(flat, /Machine text\./);
});

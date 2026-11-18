import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBody } from "./render.js";
import { twinMarkdown } from "./build.js";

const context = { file: "cards/index.site-page.card", pageSitePath: "index.site-page.card", base: "/" };
const card = (state: string, text: string): string => `{% question state="${state}" %}\n${text}\n{% /question %}`;
const body = `{% questions %}\n${card("answered", "**Does it keep history?** Yes.\n\n- Git as history")}\n${card("open", "**Does it feel like home?**")}\n{% /questions %}`;

test("each question renders as a card that names its kind in words", () => {
  const { html } = renderBody(body, context);
  assert.match(html, /<div class="question-cards"><div class="question-card question-answered">/);
  assert.match(html, /<strong>Does it keep history\?<\/strong> Yes\.<\/p><ul><li>Git as history<\/li><\/ul><p class="question-state">Bee Box has an answer<\/p>/);
  assert.match(html, /<div class="question-card question-open"><p><strong>Does it feel like home\?<\/strong><\/p><p class="question-state">Still open<\/p>/);
});

test("an unknown state, an empty card, and loose text among the cards fail the build", () => {
  assert.throws(() => renderBody(`{% questions %}\n${card("maybe", "**Q?**")}\n{% /questions %}`, context));
  assert.throws(() => renderBody('{% questions %}\n{% question state="open" %}\n{% /question %}\n{% /questions %}', context), /needs a body/);
  assert.throws(() => renderBody(`{% questions %}\nLoose text.\n\n${card("open", "**Q?**")}\n{% /questions %}`, context), /only question tags/);
  assert.throws(() => renderBody("{% questions %}\n{% /questions %}", context), /only question tags/);
});

test("the machine-facing twin says which kind each question is", () => {
  const twin = twinMarkdown(body, { nuggets: [], asides: new Map() });
  assert.match(twin, /_Bee Box has an answer:_\n\n?\*\*Does it keep history\?\*\* Yes\./);
  assert.match(twin, /_Still open:_\n\n?\*\*Does it feel like home\?\*\*/);
  assert.doesNotMatch(twin, /{%/);
});

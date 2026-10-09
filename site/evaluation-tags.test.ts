import assert from "node:assert/strict";
import { test } from "node:test";
import { twinMarkdown } from "./build.js";
import { renderBody } from "./render.js";

const context = { file: "cards/x.doc.card", pageSitePath: "x.doc.card", base: "/" };

test("a model pill names the model and carries its vendor", () => {
  const html = renderBody('{% model name="Gemini 3.1 Pro" vendor="google" /%} said so.', context).html;
  assert.match(html, /<span class="model-pill model-google">Gemini 3\.1 Pro<\/span> said so\./);
});

test("a verdict states its grade in words, not only color", () => {
  const html = renderBody('Whisper {% verdict is="failed" /%} wrote words.', context).html;
  assert.match(html, /class="verdict verdict-failed"><span aria-hidden="true">✗<\/span> Failed<\/span>/);
});

test("unknown vendors and verdicts fail the build instead of rendering", () => {
  assert.throws(() => renderBody('{% model name="X" vendor="acme" /%}', context), /malformed markup/);
  assert.throws(() => renderBody('Whisper {% verdict is="great" /%} wrote words.', context), /malformed markup/);
});

test("a sample box keeps its title and body", () => {
  const html = renderBody('{% sample title="8–9 · One wrong sound" %}\n**Recorded:** twice.\n{% /sample %}', context).html;
  assert.match(html, /<div class="sample-spec"><p class="sample-title">8–9 · One wrong sound<\/p><p><strong>Recorded:<\/strong> twice\.<\/p><\/div>/);
});

test("the twin keeps model names, verdicts, and sample titles", () => {
  const body = '{% sample title="Coughs" %}\nTwo coughs.\n{% /sample %}\n\n- {% model name="Whisper" vendor="openai" /%} {% verdict is="failed" /%} wrote words.';
  const twin = twinMarkdown(body, { nuggets: [], asides: new Map() });
  assert.match(twin, /\*\*Sample: Coughs\*\*\n/);
  assert.match(twin, /- \*\*Whisper\*\* \[Failed] wrote words\./);
  assert.doesNotMatch(twin, /{%/);
});

test("a sample must be a block with a body", () => {
  assert.throws(() => renderBody('A {% sample title="Coughs" %}two coughs{% /sample %} B', context), /malformed markup/);
  assert.throws(() => renderBody('{% sample title="Coughs" /%}', context), /needs a body/);
});

test("the twin finds attributes in any order and keeps names literal", () => {
  const refs = { nuggets: [], asides: new Map() };
  assert.match(twinMarkdown('{% model vendor="google" name="X" /%} said so.', refs), /^\*\*X\*\* said so\./);
  assert.match(twinMarkdown('{% model name="X [help](https://example.org)" vendor="google" /%}', refs), /\*\*X \\\[help\\]\(https:\/\/example\.org\)\*\*/);
});

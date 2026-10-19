// # Markdoc `{% quote %}` attribution
//
// The `from` attribute survives the shared Markdoc transform so renderers can
// distinguish a third party's exact words from an unattributed user quote.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc, { type Tag } from "@markdoc/markdoc";
import { lintBodyMarkdoc } from "../../src/core/body-markdoc-lint.js";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, validate } = Markdoc;

function isTag(value: unknown): value is Tag {
  return typeof value === "object" && value !== null && "name" in value;
}

function asTag(value: unknown): Tag {
  if (!isTag(value)) throw new Error("Expected a Markdoc tag");
  return value;
}

function transformedRoot(src: string): Tag {
  return asTag(transform(parse(src), markdocConfig));
}

function quoteTag(src: string): Tag {
  const paragraph = asTag(transformedRoot(src).children[0]);
  for (const child of paragraph.children) {
    if (isTag(child) && child.name === "QuoteInline") return child;
  }
  throw new Error("No inline quote in transformed tree");
}

function blockQuoteTag(src: string): Tag {
  return asTag(transformedRoot(src).children[0]);
}

function validationMessages(src: string): string[] {
  return validate(parse(src), markdocConfig).map((entry) => entry.error.message);
}

// ## Third-party attribution is preserved
void test("Third-party attribution is preserved", async (t) => {
  // doctest:L37
  const attributed = quoteTag('{% quote from="Rina Patel, studio owner" %}Exact words.{% /quote %}');
  t.check(`${attributed.name}:${attributed.attributes["from"]}`, "QuoteInline:Rina Patel, studio owner");
});

// ## Existing unattributed quotes remain valid
void test("Existing unattributed quotes remain valid", async (t) => {
  // doctest:L46
  const unattributed = quoteTag("{% quote %}The user's exact words.{% /quote %}");
  t.check(`${unattributed.name}:${String(unattributed.attributes["from"])}`, "QuoteInline:undefined");
});

// ## A named treatment survives on a block quote
//
// The renderer receives the closed treatment name. Omitting it remains distinct
// from explicitly requesting `plain`, allowing the active card theme to supply
// its own default.
void test("The renderer receives the closed treatment name.", async (t) => {
  // doctest:L59
  const layered = blockQuoteTag('{% quote from="A participant" treatment="layered" %}\nKeep the example close.\n{% /quote %}');
  t.check(`${layered.name}:${layered.attributes["treatment"]}:${layered.attributes["from"]}`, "QuoteBlock:layered:A participant");

  // doctest:L64
  await t.checkText(String(blockQuoteTag("{% quote %}\nTheme default.\n{% /quote %}").attributes["treatment"]), "undefined");
});

// ## Treatment names are validated
void test("Treatment names are validated", async (t) => {
  // doctest:L72
  t.check(validationMessages('{% quote treatment="floating" %}\nNo such treatment.\n{% /quote %}'), [
    "Attribute 'treatment' must match one of [\"layered\",\"inset\",\"plain\"]. Got 'floating' instead.",
  ]);
});

// ## An inline quote stays inline and reports block-only treatment use
//
// An explicit treatment never turns a quote inside a sentence into block markup.
// The validation issue flows through the existing card-body warning pipeline.
void test("An explicit treatment never turns a quote inside a sentence into block markup.", async (t) => {
  // doctest:L85
  const inlineLayered = quoteTag('Before {% quote treatment="layered" %}exact words{% /quote %} after.');
  t.check(`${inlineLayered.name}:${inlineLayered.attributes["treatment"]}`, "QuoteInline:layered");

  // doctest:L90
  t.check(validationMessages('Before {% quote treatment="layered" %}exact words{% /quote %} after.'), [
    "Quote treatment 'layered' applies only to block quotes; this quote remains inline",
  ]);

  // doctest:L96
  const [inlineWarning] = lintBodyMarkdoc('Before {% quote treatment="layered" %}exact words{% /quote %} after.');
  t.check(`${inlineWarning?.severity}:${inlineWarning?.message}`, "warning:Markdoc body issue at line 1 (quote): Quote treatment 'layered' applies only to block quotes; this quote remains inline");
});

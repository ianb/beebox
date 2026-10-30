// # Rendered todos carry the collector's locator
//
// A rendered `{% todo %}` needs the same locator the collector gives it, so a
// tick (Track 3) and a plate-state lookup (Track 2) address the todo the reader
// sees (`docs/plans/todos-ui.md`). `Markdown.tsx` runs `assignLocators` on the
// parsed body with the card's body line offset and stamps each todo node
// (`stampLocators`); the `todo` transform in `markdoc-config.ts` copies the
// stamp onto the `Tag` as `locator`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, Tag } from "@markdoc/markdoc";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { markdocConfig } from "../../../../shared/markdoc-config/tags/core.js";
import { assignLocators, stampLocators } from "../../../../shared/todo-locators.js";
import { extractBodyTodos } from "../../../../core/todo/extract/body.js";
import { TodoBlock, TodoInline } from "../../../src/components/Markdown/Todo.js";
import { MarkdownRenderContext } from "../../../src/lib/markdown-render.js";

globalThis.React = React;
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers, Tag: MarkdocTag } = Markdoc;

/** Every TodoInline/TodoBlock tag in a transformed tree, in document order. */
function todoTags(node: RenderableTreeNode): Tag[] {
  if (!MarkdocTag.isTag(node)) return [];
  const here = node.name === "TodoInline" || node.name === "TodoBlock" ? [node] : [];
  return [...here, ...node.children.flatMap(todoTags)];
}

function locatorsOf(body: string, lineOffset: number | null): string {
  const ast = parse(body);
  if (lineOffset !== null) stampLocators(assignLocators(ast, lineOffset));
  return todoTags(transform(ast, markdocConfig)).map((tag) => JSON.stringify(tag.attributes["locator"] ?? null)).join(" ");
}

const body = [
  "# Porch",
  "",
  "{% todo %}Order lumber{% /todo %} and {% todo due=\"2026-09-15\" %}book the inspector{% /todo %}",
  "",
  "{% todo %}",
  "Pick a stain colour",
  "{% /todo %}",
].join("\n");

// ## The locator survives Markdoc's transform
//
// `Markdoc.transform` resolves the tree first, which clones every node, so a
// lookup keyed by the parsed node object would miss. The stamp rides on the
// clone. With a four-line frontmatter block, the body's first line is file
// line 5:
void test("Markdoc.transform resolves the tree first, which clones every node, so a look...", async (t) => {
  await t.checkText(locatorsOf(body, 4), "{\"kind\":\"body\",\"line\":7} {\"kind\":\"body\",\"line\":7,\"nth\":2} {\"kind\":\"body\",\"line\":9}");
});

// They are exactly the collector's locators for the same body:
void test("They are exactly the collector's locators for the same body:", async (t) => {
  const collected = extractBodyTodos({ relPath: "Porch.doc.card", bodyText: body, lineOffset: 4 });
  await t.checkText(collected.ok ? collected.items.map((item) => JSON.stringify(item.locator)).join(" ") : collected.message, "{\"kind\":\"body\",\"line\":7} {\"kind\":\"body\",\"line\":7,\"nth\":2} {\"kind\":\"body\",\"line\":9}");
});

// ## Without a card, no locator
//
// Markdown that is not a card's body (chat, a commit message) is never
// stamped, and its todos carry no locator:
void test("Markdown that is not a card's body (chat, a commit message) is never stamped,...", async (t) => {
  t.check(locatorsOf(body, null), "null null null");
});

// ## An author cannot write one
//
// `locator` is not a declared attribute, so a hand-written one is dropped; the
// only locator a todo can carry is the stamped one.
void test("locator is not a declared attribute, so a hand-written one is dropped; the on...", async (t) => {
  await t.checkText(locatorsOf('{% todo locator="99" %}Forged{% /todo %}', null), "null");

  await t.checkText(locatorsOf('{% todo locator="99" %}Forged{% /todo %}', 0), "{\"kind\":\"body\",\"line\":1}");
});

// ## It reaches the rendered element
//
// Rendered with the todo components, each todo's element names its locator,
// which is what the card summary scrolls to and what a later tick reads.
void test("Rendered with the todo components, each todo's element names its locator, whi...", async (t) => {
  const ast = parse(body);
  stampLocators(assignLocators(ast, 4));
  const render = { onNavigate: () => {}, basePath: undefined, boxSlug: undefined, onJumpToQuote: undefined, openImageLink: undefined, cardPath: "Porch.doc.card" };
  const html = renderToStaticMarkup(React.createElement(MarkdownRenderContext.Provider, { value: render },
    renderers.react(transform(ast, markdocConfig), React, { components: { TodoInline, TodoBlock } })));
  t.check([...html.matchAll(/data-todo-locator="([^"]*)"/g)].map((m) => m[1]).join(" "), "7 7#2 9");
});

// ## It carries the collector's text
//
// A tick sends the todo's words for the server to compare with what the
// collector extracts (`todos.setStatus`). The transform adds `text` beside
// `locator` from the same flattening (`shared/todo-text.ts`), so a link keeps
// its label and a nested `see-also` drops out, exactly as the collector reads
// them. Unlocated todos carry no text.
void test("A tick sends the todo's words for the server to compare with what the collect...", async (t) => {
  const linked = [
    "{% todo %}Call the [roofer](https://example.com) back{% /todo %}",
    "",
    "{% todo %}",
    "Pick a stain {% see-also ref=\"Stains.doc.card\" %}options{% /see-also %} colour",
    "{% /todo %}",
  ].join("\n");
  const linkedAst = parse(linked);
  stampLocators(assignLocators(linkedAst, 0));
  const rendered = todoTags(transform(linkedAst, markdocConfig)).map((tag) => tag.attributes["text"]);
  const extracted = extractBodyTodos({ relPath: "Porch.doc.card", bodyText: linked, lineOffset: 0 });
  t.check([rendered, extracted.ok ? extracted.items.map((item) => item.text) : extracted.message], [
    [
      "Call the roofer back",
      "Pick a stain colour",
    ],
    [
      "Call the roofer back",
      "Pick a stain colour",
    ],
  ]);

  t.check(todoTags(transform(parse(linked), markdocConfig)).map((tag) => tag.attributes["text"] ?? null), [
    null,
    null,
  ]);
});

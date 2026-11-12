// A card's document hands its headings to the card's contents menu from the
// tree it renders. A text-only edit keeps the same outline, so the menu does
// not rebuild; a card embedded in the body does not add its own headings.
// Issue: issues/closed/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { Markdown, type MarkdownComponentOverrides } from "../../../src/components/Markdown/body.js";
import { CardOutlineContext, useCardOutline } from "../../../src/components/CardContents/CardOutlineContext.js";
import type { OutlineEntry } from "../../../src/components/CardContents/outline.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

/** Every outline the surface held, in order: what the contents menu was given. */
let seen: (readonly OutlineEntry[] | null)[] = [];

function Surface({ children }: { children: ReactNode }) {
  const [outline, publish] = useCardOutline();
  if (seen.at(-1) !== outline) seen.push(outline);
  return h(CardOutlineContext.Provider, { value: publish }, children);
}

const onNavigate = () => {};

function card(text: string, components?: MarkdownComponentOverrides) {
  return h(BoxSlugProvider, { boxSlug: "test", children: h(Surface, null,
    h(Markdown, { prose: "block", outline: true, onNavigate, basePath: "_content/docs/Plan.doc.card", ...(components ? { components } : {}), children: text })) });
}

const doc = (intro: string) => `${intro}\n\n## Plan\n\nText.\n\n## Lodging\n\n### Food\n\nMore.\n`;

void test("the surface holds the document's headings; a text edit keeps the same outline", async (t) => {
  seen = [];
  const view = await mount(card(doc("Intro.")));
  t.teardown(() => view.unmount());
  const first = seen.at(-1);
  t.check(first?.map((entry) => entry.text), ["Plan", "Lodging", "Food"]);
  await view.rerender(card(doc("Intro, rewritten by an agent.")));
  t.check(seen.at(-1), is(first));
  await view.rerender(card(doc("Intro.").replace("## Lodging", "## Hotels")));
  t.check(seen.at(-1)?.map((entry) => entry.text), ["Plan", "Hotels", "Food"]);
  // The body goes away (no body text): the menu has nothing to list.
  await view.rerender(h(BoxSlugProvider, { boxSlug: "test", children: h(Surface, null, null) }));
  t.check(seen.at(-1), null);
});

void test("a card embedded in the body does not publish into the outer card", async (t) => {
  seen = [];
  // An embed that renders another card's document, as an embedded card front
  // does. It updates on its own (its own file changed) while the outer body
  // stays the same; on first render the outer body publishes last and would
  // hide a leak.
  let embedded = "## Embedded\n\n## Also embedded\n";
  const Img = () => h(Markdown, { prose: "block", outline: true, onNavigate, children: embedded });
  const text = `${doc("Intro.")}\n![Other](Other.doc.card)\n`;
  const view = await mount(card(text, { Img }));
  t.teardown(() => view.unmount());
  embedded = "## Embedded, edited\n";
  await view.rerender(card(text, { Img: () => Img() }));
  t.check([...view.container.querySelectorAll("h2")].map((heading) => heading.textContent), ["Plan", "Lodging", "Embedded, edited"]);
  t.check(seen.at(-1)?.map((entry) => entry.text), ["Plan", "Lodging", "Food"]);
});

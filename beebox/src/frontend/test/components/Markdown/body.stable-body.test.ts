// A rendered Markdown body keeps its DOM nodes when only its surroundings
// change: a new `onNavigate` from the host, or text added elsewhere in the
// body. A remount replaces the node and resets anything inside it (an embed's
// state, focus, a reader's place). Issue:
// issues/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import type { ViewTarget } from "../../../src/lib/view-url.js";

const source = [
  "Intro with [a link](Notes.md). {% source href=\"https://en.wikipedia.org/wiki/Chemical_bond\" %}Bonds hold atoms.{% /source %}",
  "",
  "## Section",
  "",
  "> A quoted line.",
  "",
  "{% source href=\"https://www.britannica.com/science/chemical-bonding\" %}",
  "A block citation.",
  "{% /source %}",
  "",
].join("\n");

function render(text: string, onNavigate: (target: ViewTarget) => void) {
  return h(BoxSlugProvider, { boxSlug: "test", children: h(Markdown, { prose: "block", outline: true, onNavigate, basePath: "_content/docs/Repro.doc.card", children: text }) });
}

/** The body's nodes a remount would replace, by name. */
function nodes(container: HTMLElement): Record<string, Element | null> {
  return {
    link: container.querySelector("a[href]:not([target])"),
    inlineCitation: container.querySelector(".bbx-paragraph a[target=_blank]"),
    blockCitation: container.querySelector("figure[data-source-href]"),
    blockquote: container.querySelector("blockquote"),
    heading: container.querySelector("h2"),
  };
}

function replaced(before: Record<string, Element | null>, now: Record<string, Element | null>): string[] {
  return Object.keys(before).filter((name) => before[name] === null || before[name] !== now[name]);
}

void test("a new navigation callback from the host keeps every body node", async (t) => {
  // The companion pane makes a new `onNavigate` on every workspace change
  // (a tab pinned, an agent turn); the body did not change.
  const view = await mount(render(source, () => {}));
  t.teardown(() => view.unmount());
  const before = nodes(view.container);
  await view.rerender(render(source, () => {}));
  t.check(replaced(before, nodes(view.container)), []);
});

void test("text added at the end keeps the nodes before it", async (t) => {
  const onNavigate = () => {};
  const view = await mount(render(source, onNavigate));
  t.teardown(() => view.unmount());
  const before = nodes(view.container);
  await view.rerender(render(`${source}\nAn appended paragraph.\n`, onNavigate));
  t.check(replaced(before, nodes(view.container)), []);
});

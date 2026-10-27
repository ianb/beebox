// A rendered Markdown body keeps its DOM nodes when only its surroundings
// change: a new `onNavigate` from the host, or text added elsewhere in the
// body. A remount replaces the node and resets anything inside it (an embed's
// state, focus, a reader's place). Issue:
// issues/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, useEffect, type ComponentType } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Markdown, type MarkdownComponentOverrides } from "../../../src/components/Markdown/body.js";
import { CARD_EMBED_COMPONENTS } from "../../../src/components/FigureEmbed.js";
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

// An embed (`![](…)`) is a boundary: a host re-render reconciles it in place.
// The probe stands in for the card embed, whose real `FileView` fetches over
// tRPC; it counts its mounts. Named `Img`, as the real embed is, so `Para`
// drops the wrapper around a lone one.
let probeMounts = 0;
function Img({ src }: { src?: string }) {
  useEffect(() => { probeMounts += 1; }, []);
  return h("span", { "data-probe": src });
}
// eslint-disable-next-line no-restricted-syntax -- widen the probe to Markdoc's uniform component-map type; Markdoc calls it with the `image` tag's props only
const PROBE_COMPONENTS: MarkdownComponentOverrides = { Img: Img as unknown as ComponentType<Record<string, unknown>> };

function renderEmbed(text: string, onNavigate: (target: ViewTarget) => void) {
  return h(BoxSlugProvider, { boxSlug: "test", children: h(Markdown, { prose: "block", onNavigate, basePath: "_content/docs/Repro.doc.card", components: PROBE_COMPONENTS, children: text }) });
}

void test("an embed mounts once across host re-renders and follows its own src", async (t) => {
  probeMounts = 0;
  const embed = "Intro.\n\n![Atoms](../figures/Atoms.figure.card)\n";
  const view = await mount(renderEmbed(embed, () => {}));
  t.teardown(() => view.unmount());
  await view.rerender(renderEmbed(embed, () => {}));
  await view.rerender(renderEmbed(`${embed}\nMore text.\n`, () => {}));
  t.check(probeMounts, 1);
  // A lone embed is not wrapped in a paragraph.
  t.check(view.container.querySelector("[data-probe]")?.parentElement?.className, "prose prose-sm max-w-none bbx-theme-prose");
  // A changed src reaches the embed: it re-renders with the new target.
  await view.rerender(renderEmbed("Intro.\n\n![Bonds](../figures/Bonds.figure.card)\n", () => {}));
  t.check(view.container.querySelector("[data-probe]")?.getAttribute("data-probe"), "../figures/Bonds.figure.card");
});

void test("the card embed keeps the name Para unwraps", async (t) => {
  // `Para` drops its wrapper around a lone child by component name (`Img`).
  t.check(CARD_EMBED_COMPONENTS.Img?.name, "Img");
});

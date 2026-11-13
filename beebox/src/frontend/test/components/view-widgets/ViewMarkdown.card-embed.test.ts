// A view's `<Markdown>` embeds a card written as an image, as a card's own page
// does: `![Caption](/_content/figures/Atom.figure.card?element=H)` goes to the
// view host's `renderInline` with a box-absolute ref and the caption. Images
// and external URLs stay `<img>`.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, type ComponentType } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ViewMarkdown } from "../../../src/components/view-widgets/ViewMarkdown.js";
import { ViewHostProvider, type ViewHost } from "../../../src/lib/view-host.js";
import { LightboxProvider } from "../../../src/components/LightboxProvider.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

interface InlineCall {
  ref: string;
  caption: string | undefined;
}

function tags(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector), (el) => el.tagName);
}

function makeHost(calls: InlineCall[]): ViewHost {
  return {
    openCard: () => {},
    useResolvedRef: (cardRef) => ({ path: cardRef, title: cardRef, type: "", exists: true }),
    renderInline: (ref, opts) => {
      calls.push({ ref, caption: opts?.caption });
      return h("span", { "data-inline": ref });
    },
    basePath: "",
    boxSlug: "test",
  };
}

const CARD = { path: "_content/docs/Note.doc.card", bodyLineOffset: 0 };

function render(text: string, { calls, components }: { calls: InlineCall[]; components?: Record<string, ComponentType<Record<string, unknown>>> }) {
  return h(BoxSlugProvider, {
    boxSlug: "test",
    children: h(LightboxProvider, {
      children: h(ViewHostProvider, {
        value: makeHost(calls),
        children: h(ViewMarkdown, { card: CARD, ...(components === undefined ? {} : { components }), children: text }),
      }),
    }),
  });
}

void test("an embed src goes to the host with a box-absolute ref, its query, and the caption", async (t) => {
  const calls: InlineCall[] = [];
  const view = await mount(render("![Hydrogen](/_content/figures/Atom.figure.card?element=H)", { calls }));
  t.teardown(() => view.unmount());
  t.check(calls.map((c) => c.caption), ["Hydrogen"]);
  t.check(calls.map((c) => c.ref), ["/_content/figures/Atom.figure.card?element=H"]);
  t.check(tags(view.container, "[data-card-embed]"), ["DIV"]);
  t.check(tags(view.container, "[role=img]"), []);
});

void test("a relative embed src resolves against the card's path", async (t) => {
  const calls: InlineCall[] = [];
  const view = await mount(render("![](../figures/Atom.figure.card)", { calls }));
  t.teardown(() => view.unmount());
  t.check(calls, [{ ref: "/_content/figures/Atom.figure.card", caption: undefined }]);
});

void test("an image path and an external URL stay images", async (t) => {
  const calls: InlineCall[] = [];
  const view = await mount(render("![a](photo.png)\n\n![b](https://example.com/x.jpg)", { calls }));
  t.teardown(() => view.unmount());
  t.check(calls, []);
  // The default image (happy-dom cannot load it, so it shows its failed-load box).
  t.check(Array.from(view.container.querySelectorAll("[role=img]"), (el) => el.getAttribute("aria-label")), ["Failed to load image: a", "Failed to load image: b"]);
});

void test("the caller's components.Img wins over the embed", async (t) => {
  const calls: InlineCall[] = [];
  const Mine = () => h("span", { "data-mine": "" });
  // eslint-disable-next-line no-restricted-syntax -- widen the probe to the uniform override-map component type
  const view = await mount(render("![x](../figures/Atom.figure.card)", { calls, components: { Img: Mine as unknown as ComponentType<Record<string, unknown>> } }));
  t.teardown(() => view.unmount());
  t.check(calls, []);
  t.check(tags(view.container, "[data-mine]"), ["SPAN"]);
});

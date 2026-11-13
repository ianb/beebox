// `<CardRef embed>` renders the card inline through the view host, with no chip;
// the chip's Expand passes the ref's `view` and `params` too.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount, byRole } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CardRef } from "../../../src/components/view-widgets/CardRef.js";
import { ViewHostProvider, type ViewHost } from "../../../src/lib/view-host.js";

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
    useResolvedRef: (cardRef) => ({ path: cardRef, title: "Atom", type: "figure", exists: true }),
    renderInline: (ref, opts) => {
      calls.push({ ref, caption: opts?.caption });
      return h("span", { "data-inline": ref });
    },
    basePath: "",
    boxSlug: "test",
  };
}

void test("embed renders the card inline with its params and caption, and no chip", async (t) => {
  const calls: InlineCall[] = [];
  const view = await mount(h(ViewHostProvider, {
    value: makeHost(calls),
    children: h(CardRef, { cardRef: "/_content/figures/Atom.figure.card", params: { element: "H" }, embed: true, caption: "Hydrogen" }),
  }));
  t.teardown(() => view.unmount());
  t.check(calls, [{ ref: "/_content/figures/Atom.figure.card?element=H", caption: "Hydrogen" }]);
  t.check(tags(view.container, "[data-card-embed]"), ["DIV"]);
  t.check(tags(view.container, "button"), []);
});

void test("Expand passes view and params to the host", async (t) => {
  const calls: InlineCall[] = [];
  const view = await mount(h(ViewHostProvider, {
    value: makeHost(calls),
    children: h(CardRef, { cardRef: "/_content/figures/Atom.figure.card?a=1", view: "page", params: { element: "H" } }),
  }));
  t.teardown(() => view.unmount());
  byRole(view.container, { role: "button", name: "Expand" }).click();
  await view.rerender(h(ViewHostProvider, {
    value: makeHost(calls),
    children: h(CardRef, { cardRef: "/_content/figures/Atom.figure.card?a=1", view: "page", params: { element: "H" } }),
  }));
  t.check(calls.at(-1), { ref: "/_content/figures/Atom.figure.card?a=1&view=page&element=H", caption: undefined });
});

// The contents button is full while the reader scrolls the card, and stays at
// rest when the card scrolls on its own: the browser keeping the reader's
// place while an agent's edit grows the text above. The full look is an
// attribute set without a React render.
// Issue: issues/closed/bugs/2026-11-03-card-contents-menu-collapses-and-reappears.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, createRef } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CardContentsMenu } from "../../../src/components/CardContents/CardContentsMenu.js";

const SECTIONS = ["Plan", "Lodging", "Food", "Costs"];
const entries = [...SECTIONS, "Composing"].map((text) => ({ id: text.toLowerCase(), level: 2, text }));

function Card({ front }: { front: React.RefObject<HTMLDivElement | null> }) {
  return h("div", { id: "scroller", style: { overflowY: "auto", height: "200px" } },
    h("textarea", { id: "composer" }),
    h("div", { ref: front },
      h(CardContentsMenu, { id: "contents", frontRef: front, entries }),
      // "Composing" is in the document but not on screen: its region shows an editor.
      h("div", { "data-card-outline": "" }, ...SECTIONS.map((text) => h("h2", { key: text, id: text.toLowerCase() }, text)))));
}

async function setup() {
  const view = await mount(h(Card, { front: createRef<HTMLDivElement>() }));
  const scroller = view.container.querySelector<HTMLElement>("#scroller");
  const menu = view.container.querySelector<HTMLElement>(".bbx-card-contents");
  if (scroller === null || menu === null) throw new Error("card did not render");
  const scroll = (before?: Event) => view.act(() => {
    if (before !== undefined) (before.type === "keydown" ? view.container.querySelector("#composer") ?? scroller : scroller).dispatchEvent(before);
    scroller.dispatchEvent(new Event("scroll"));
  });
  return { view, scroller, menu, scroll };
}

void test("a scroll no reader input started leaves the button at rest", async (t) => {
  const { view, menu, scroll } = await setup();
  t.teardown(() => view.unmount());
  await scroll();
  // An arrow key typed in the chat composer is not a scroll of the card.
  await scroll(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  t.check(menu.hasAttribute("data-scrolling"), false);
});

void test("the reader's wheel makes it full, without rendering the menu", async (t) => {
  const { view, menu, scroll } = await setup();
  t.teardown(() => view.unmount());
  view.resetRenders();
  await scroll(new WheelEvent("wheel", { bubbles: true }));
  await scroll();
  t.check({ full: menu.hasAttribute("data-scrolling"), menuRenders: view.renders()["CardContentsMenu"] ?? 0 }, { full: true, menuRenders: 0 });
});

void test("the open list leaves out a heading that is not on screen", async (t) => {
  const { view } = await setup();
  t.teardown(() => view.unmount());
  const button = view.container.querySelector<HTMLButtonElement>("#contents");
  await view.act(() => { button?.click(); });
  t.check([...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent), SECTIONS);
});

void test("when the page itself scrolls, Page Down on a control in the card makes it full", async (t) => {
  const front = createRef<HTMLDivElement>();
  const view = await mount(h("div", { ref: front },
    h(CardContentsMenu, { id: "contents", frontRef: front, entries }),
    h("button", { id: "in-card" }, "A control in the card"),
    h("div", { "data-card-outline": "" }, ...SECTIONS.map((text) => h("h2", { key: text, id: text.toLowerCase() }, text)))));
  t.teardown(() => view.unmount());
  await view.act(() => {
    view.container.querySelector("#in-card")?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
  });
  t.check(view.container.querySelector(".bbx-card-contents")?.hasAttribute("data-scrolling"), true);
});

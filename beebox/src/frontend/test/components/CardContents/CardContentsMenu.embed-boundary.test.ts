// The contents menu follows the card's own document, not an embed's DOM
// activity: a figure in the body that redraws must not make the menu re-read
// the outline. Issue:
// issues/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, createRef } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CardContentsMenu } from "../../../src/components/CardContents/CardContentsMenu.js";

const front = createRef<HTMLDivElement>();

function Front() {
  return h("div", null,
    h(CardContentsMenu, { id: "contents", frontRef: front }),
    h("div", { ref: front },
      h("div", { "data-card-outline": "" },
        // Four headings: the fewest that give a card a contents menu.
        ...["Plan", "Lodging", "Food", "Costs"].map((text) => h("h2", { key: text, id: text.toLowerCase() }, text)),
        h("div", { "data-card-embed": "", id: "embed" }))));
}

/** The menu's sections, as its dropdown (portaled to the body) lists them. */
async function sections(view: Awaited<ReturnType<typeof mount>>): Promise<string[]> {
  const button = view.container.querySelector<HTMLButtonElement>("#contents");
  await view.act(() => { button?.click(); });
  const items = [...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent);
  await view.act(() => { button?.click(); });
  return items;
}

/** Add a heading under `parent`, and let the menu's observer run. */
async function addHeading(view: Awaited<ReturnType<typeof mount>>, { parent, text }: { parent: Element | null; text: string }): Promise<void> {
  await view.act(async () => {
    const heading = document.createElement("h2");
    heading.id = text.toLowerCase();
    heading.textContent = text;
    parent?.append(heading);
    await Promise.resolve();
  });
}

void test("a change inside an embed leaves the outline; a change in the card re-reads it", async (t) => {
  const view = await mount(h(Front));
  t.teardown(() => view.unmount());
  t.check(await sections(view), ["Plan", "Lodging", "Food", "Costs"]);
  // An embed is not an outline root here, so a re-read would list its heading.
  await addHeading(view, { parent: view.container.querySelector("#embed"), text: "Drawn" });
  t.check(await sections(view), ["Plan", "Lodging", "Food", "Costs"]);
  // The same change in the card's own body is read. That read sees the
  // embed's heading too: the boundary filters change events, not content.
  await addHeading(view, { parent: view.container.querySelector("[data-card-outline]"), text: "Notes" });
  t.check(await sections(view), ["Plan", "Lodging", "Food", "Costs", "Drawn", "Notes"]);
});

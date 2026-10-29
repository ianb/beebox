// The printed card's way back: the box and the friendly path always, and a QR
// code of the card's address only when the page was reached over a network.
// Issue: issues/features/2026-10-01-printable-cards.md.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CardPrintFooter, cardAddress } from "../../../../../src/components/themes/ThemedFileCard/view/CardPrintFooter.js";

async function footerAt(url: string) {
  const view = await mount(h(CardPrintFooter, { boxSlug: "kitchen", path: "/_content/recipes/Soup #2.recipe.card", here: new URL(url) }));
  const footer = view.container.querySelector("footer");
  const state = { text: footer?.textContent, qr: footer?.querySelector("svg")?.tagName };
  await view.unmount();
  return state;
}

void test("a LAN origin prints a QR code; localhost prints the path alone", async (t) => {
  t.check(await footerAt("http://192.168.1.20:3000/kitchen/browse/_content/recipes"), {
    text: "kitchen · recipes/Soup #2.recipe.cardScan to open this card in the box.",
    qr: "svg",
  });
  t.check(await footerAt("http://localhost:3210/kitchen/browse/_content/recipes"), {
    text: "kitchen · recipes/Soup #2.recipe.card",
    qr: undefined,
  });
});

void test("the QR address encodes the path so a # stays part of the filename", async (t) => {
  t.check(cardAddress("http://192.168.1.20:3000", { boxSlug: "kitchen", path: "/_content/recipes/Soup #2.recipe.card" }), "http://192.168.1.20:3000/kitchen/views/_content/recipes/Soup%20%232.recipe.card");
});

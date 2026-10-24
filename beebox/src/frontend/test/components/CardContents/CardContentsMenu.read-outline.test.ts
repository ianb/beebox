// The contents menu reads the card document's own headings: those of the
// first outline root, not those of a card embedded in its body.
// First, and bare: the happy-dom window must exist before the DOM is used.
import "../../helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readOutline } from "../../../src/components/CardContents/CardContentsMenu.js";

void test("an embedded card's headings stay out of the outline", async (t) => {
  const front = document.createElement("div");
  front.innerHTML = [
    "<div data-card-outline>",
    "<h2 id=\"plan\">Plan</h2><h2 id=\"lodging\">Lodging</h2>",
    "<div data-card-outline><h2 id=\"embedded\">Embedded card</h2></div>",
    "<h3 id=\"food\">Food</h3><h2 id=\"costs\">Costs</h2>",
    "</div>",
  ].join("");
  t.check(readOutline(front)?.items, [
    { id: "plan", level: 2, text: "Plan", depth: 0 },
    { id: "lodging", level: 2, text: "Lodging", depth: 0 },
    { id: "food", level: 3, text: "Food", depth: 1 },
    { id: "costs", level: 2, text: "Costs", depth: 0 },
  ]);
});

// Printing one card marks that card and its ancestors for the print CSS, so a
// chat workspace's transcript and other cards stay off the page, and clears
// the marks when printing ends.
// First, and bare: the happy-dom window must exist before the DOM is used.
import "../helpers/dom-globals.js";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { printCard } from "../../src/lib/print-card.js";

function marks() {
  return {
    scope: document.documentElement.dataset.printScope,
    target: [...document.querySelectorAll("[data-print-target]")].map((n) => n.id),
    path: [...document.querySelectorAll("[data-print-path]")].map((n) => n.id),
  };
}

void test("only the printed card and the elements around it are marked", async (t) => {
  document.body.innerHTML = '<main id="desk"><section id="transcript"></section><article id="soup"><p id="body"></p></article><article id="other"></article></main>';
  const seen: ReturnType<typeof marks>[] = [];
  window.print = () => { seen.push(marks()); };
  const soup = document.getElementById("soup");
  if (soup === null) return;
  printCard(soup);
  t.check(seen, [{ scope: "card", target: ["soup"], path: ["desk"] }]);
  window.dispatchEvent(new Event("afterprint"));
  t.check(marks(), { scope: undefined, target: [], path: [] });
});

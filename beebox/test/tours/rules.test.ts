// Rule coverage: which theme rules the studio must show, reduced to a
// selector `document.querySelector` can find.

import { test } from "tap";
import { describeUncoveredRule, isPrintOnly, reduceSelector, ruleTargets, splitSelectorList, themesNamed } from "./tour-lib/rules.js";

void test("a selector list splits at top-level commas only", (t) => {
  t.check(splitSelectorList("[data-chrome-theme=\"gilt\"] :is(.a, .b), .c[title=\"x, y\"]"), ["[data-chrome-theme=\"gilt\"] :is(.a, .b)", ".c[title=\"x, y\"]"]);
  t.end();
});

void test("a rule names a theme by its chrome or card attribute", (t) => {
  t.check(themesNamed(".bbx-box-presentation[data-chrome-theme=\"deck\"] [data-card-theme=\"paper\"] p"), ["deck", "paper"]);
  t.check(themesNamed(".bbx-app-nav"), []);
  t.end();
});

void test("user actions and pseudo-elements are stripped; the element remains", (t) => {
  t.check([
    "[data-chrome-theme=\"gilt\"] .bbx-app-nav :is(button, a):focus-visible",
    "[data-chrome-theme=\"gilt\"] #bbx-nav-place:hover::after",
    "[data-chrome-theme=\"gilt\"] .x:not(:hover) > .y",
    "[data-chrome-theme=\"gilt\"] input::placeholder",
    "[data-chrome-theme=\"gilt\"] .x:focus-within .y:active",
    "[data-chrome-theme=\"gilt\"] .x::-webkit-scrollbar-thumb",
    "[data-chrome-theme=\"gilt\"] .x:before",
    "[data-chrome-theme=\"gilt\"] .x:disabled",
    "[data-card-theme=\"gilt\"] .x[data-resting]:not(:hover, :focus-within, :has([aria-expanded=\"true\"])) .y",
  ].map(reduceSelector), [
    "[data-chrome-theme=\"gilt\"] .bbx-app-nav :is(button, a):where(*)",
    "[data-chrome-theme=\"gilt\"] #bbx-nav-place:where(*)",
    "[data-chrome-theme=\"gilt\"] .x > .y",
    "[data-chrome-theme=\"gilt\"] input",
    "[data-chrome-theme=\"gilt\"] .x:where(*) .y:where(*)",
    "[data-chrome-theme=\"gilt\"] .x",
    "[data-chrome-theme=\"gilt\"] .x",
    "[data-chrome-theme=\"gilt\"] .x:disabled",
    "[data-card-theme=\"gilt\"] .x[data-resting]:not(:has([aria-expanded=\"true\"])) .y",
  ]);
  t.end();
});

void test("print rules are left out; a screen query is not print", (t) => {
  t.check([isPrintOnly(["print"]), isPrintOnly(["screen", "print and (min-width: 600px)"]), isPrintOnly(["not print"]), isPrintOnly(["(min-width: 640px)"])], [true, true, false, false]);
  t.end();
});

void test("targets: each selector of a rule naming a theme under test, deduplicated, minus exemptions", (t) => {
  const targets = ruleTargets([
    { sheet: "gilt-chrome.css", selector: "[data-chrome-theme=\"gilt\"] .bbx-app-nav, [data-chrome-theme=\"deck\"] .bbx-app-nav, .bbx-app-nav", media: [] },
    { sheet: "gilt-chrome.css", selector: "[data-chrome-theme=\"gilt\"] .bbx-app-nav", media: [] },
    { sheet: "gilt-chrome.css", selector: "[data-chrome-theme=\"gilt\"] .bbx-card-overlay", media: [] },
    { sheet: "gilt-chrome.css", selector: "[data-chrome-theme=\"gilt\"] .bbx-app-nav", media: ["print"] },
    { sheet: "gilt-chrome.css", selector: "[data-chrome-theme=\"gilt\"] button:hover", media: ["(min-width: 640px)"] },
  ], { themes: ["gilt"], exemptions: [{ selector: ".bbx-card-overlay", reason: "modal" }] });
  t.check(targets.map(({ original, selector, media }) => ({ original, selector, media })), [
    { original: "[data-chrome-theme=\"gilt\"] .bbx-app-nav", selector: "[data-chrome-theme=\"gilt\"] .bbx-app-nav", media: [] },
    { original: "[data-chrome-theme=\"gilt\"] button:hover", selector: "[data-chrome-theme=\"gilt\"] button:where(*)", media: ["(min-width: 640px)"] },
  ]);
  const [first, second] = targets;
  if (first === undefined || second === undefined) throw new Error("expected two targets");
  t.check(describeUncoveredRule(first, { unparsable: false }), "rule matches nothing in the studio: [data-chrome-theme=\"gilt\"] .bbx-app-nav (gilt-chrome.css)");
  t.check(describeUncoveredRule(second, { unparsable: true }), "rule selector could not be tested: [data-chrome-theme=\"gilt\"] button:hover in @media (min-width: 640px) (gilt-chrome.css)");
  t.end();
});

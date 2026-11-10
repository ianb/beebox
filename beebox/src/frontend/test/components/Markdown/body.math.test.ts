// Dollar math in rendered Markdown: a formula renders through KaTeX once its
// chunk loads, a dollar amount stays text, and TeX that does not parse shows
// its source in code style with the reason in the title.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import { renderTex } from "../../../src/components/Markdown/math-render.js";

const source = [
  "Inline $E = mc^2$ and a price of $5 and $10.",
  "",
  "$$\\ce{2H2 + O2 -> 2H2O}$$",
  "",
  "Broken $\\frac{a$ here.",
].join("\n");

function render() {
  return h(BoxSlugProvider, {
    boxSlug: "test",
    children: h(Markdown, { onNavigate: () => {}, children: source }),
  });
}

function formulas(container: HTMLElement) {
  return [...container.querySelectorAll("[data-math]")].map((el) => ({
    kind: el.getAttribute("data-math"),
    tag: el.tagName,
    katex: el.querySelector(".katex") !== null,
    // KaTeX's MathML annotation holds the TeX it rendered.
    annotation: el.querySelector("annotation")?.textContent ?? null,
    source: el.querySelector("code")?.textContent ?? null,
    title: el.querySelector("code")?.getAttribute("title") ?? null,
  }));
}

test("formulas render, prices stay text, broken TeX shows its source", async (t) => {
  const view = await mount(render());
  await eventually(() => formulas(view.container).filter((f) => f.katex).length === 2, { label: "KaTeX rendered" });
  t.check(formulas(view.container), [
    { kind: "inline", tag: "SPAN", katex: true, annotation: "E = mc^2", source: null, title: null },
    { kind: "display", tag: "DIV", katex: true, annotation: "\\ce{2H2 + O2 -> 2H2O}", source: null, title: null },
    {
      kind: "source",
      tag: "SPAN",
      katex: false,
      annotation: null,
      source: "$\\frac{a$",
      title: "Formula did not render: KaTeX parse error: Unexpected end of input in a macro argument, expected '}' at end of input: \\frac{a",
    },
  ]);
  t.check(view.container.textContent?.match(/a price of [^.]*\./)?.[0], "a price of $5 and $10.");
  await view.unmount();
});

// `maxSize` (in ems) bounds a rule an agent's TeX asks for, so one formula
// cannot cover the page.
test("a huge rule is capped", async (t) => {
  const result = renderTex("\\rule{500em}{500em}", false);
  t.check("html" in result ? result.html.match(/border-right-width:\s*([\d.]+em)/)?.[1] : result.error, "20em");
});

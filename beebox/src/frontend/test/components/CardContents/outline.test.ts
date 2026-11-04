// The contents menu's rules: a document gets one at four headings of levels
// 1–3, entries indent from the shallowest level used, and the current section
// is the last heading above the reading line. The outline is the headings of
// the rendered Markdoc tree.
// Issue: issues/features/2026-10-05-markdown-toc-navigation.md.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc from "@markdoc/markdoc";
import { buildOutline, currentSection, outlineEntries, sameEntries } from "../../../src/components/CardContents/outline.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;
const h = (id: string, level: number) => ({ id, level, text: id });

void test("three headings is a short note: no menu", async (t) => {
  t.check(buildOutline([h("a", 2), h("b", 2), h("c", 2), h("d", 4)]), null);
});

void test("four headings get a menu, indented from the shallowest level", async (t) => {
  // No h1 in the body (the card title is the header), so h2 is depth 0.
  t.check(buildOutline([{ id: "plan", level: 2, text: " Plan " }, h("lodging", 3), h("food", 3), h("detail", 4), h("costs", 2)]), [
    { id: "plan", level: 2, text: "Plan", depth: 0 },
    { id: "lodging", level: 3, text: "lodging", depth: 1 },
    { id: "food", level: 3, text: "food", depth: 1 },
    { id: "costs", level: 2, text: "costs", depth: 0 },
  ]);
});

void test("the current section is the last heading at or above the line", async (t) => {
  const tops = [{ id: "a", top: -400 }, { id: "b", top: 40 }, { id: "c", top: 300 }];
  t.check([currentSection(tops, -500), currentSection(tops, 48), currentSection(tops, 40), currentSection(tops, 1000)], [null, "b", "b", "c"]);
});

void test("the outline is the tree's headings with their text, in order", async (t) => {
  const tree = new Tag("Fragment", {}, [
    new Tag("h2", { id: "plan" }, ["The ", new Tag("em", {}, ["plan"])]),
    new Tag("Para", {}, ["Text."]),
    new Tag("blockquote", {}, [new Tag("h3", { id: "quoted" }, ["Quoted"])]),
    // No id: not a heading the renderer made, so not a section.
    new Tag("h2", {}, ["Loose"]),
    new Tag("h4", { id: "deep", "data-line": "9" }, ["Deep ", 4]),
  ]);
  t.check(outlineEntries(tree), [
    { id: "plan", level: 2, text: "The plan" },
    { id: "quoted", level: 3, text: "Quoted" },
    { id: "deep", level: 4, text: "Deep 4" },
  ]);
});

void test("same headings compare equal; a changed text or level does not", async (t) => {
  const a = [h("plan", 2), h("costs", 3)];
  t.check([sameEntries(a, [h("plan", 2), h("costs", 3)]), sameEntries(a, [h("plan", 2), h("costs", 2)]),
    sameEntries(a, [h("plan", 2), { id: "costs", level: 3, text: "Costs" }]), sameEntries(a, [h("plan", 2)])], [true, false, false, false]);
});

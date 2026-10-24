// The contents menu's rules: a document gets one at four headings of levels
// 1–3, entries indent from the shallowest level used, and the current section
// is the last heading above the reading line.
// Issue: issues/features/2026-10-05-markdown-toc-navigation.md.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { buildOutline, currentSection } from "../../../src/components/CardContents/outline.js";

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

// # The place pill's face
//
// `PlacePillFace` is the pill as drawn. The live bar wraps each half's button
// in its menu; the theme studio renders the same face with fixed props, so a
// theme's nav rules meet the same markup in both.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacePillFace, type PlacePillMenu } from "../../../src/components/app-bar-faces/PlacePillFace.js";

globalThis.React = React;

const closed: PlacePillMenu = ({ half, className, trigger }) => React.createElement("div", { className, "data-half": half },
  trigger({ open: false, toggle: () => {}, ariaProps: { "aria-haspopup": "menu", "aria-expanded": false } }));

/** The pill's hook class, then each half as `half #id "accessible name": text`. */
function face(props: Omit<React.ComponentProps<typeof PlacePillFace>, "menu">): string[] {
  const html = renderToStaticMarkup(React.createElement(PlacePillFace, { ...props, menu: closed }));
  const root = /^<div class="(bbx-place-pill)\b/.exec(html)?.[1] ?? "no bbx-place-pill root";
  const halves = [...html.matchAll(/data-half="(\w+)"><button[^>]*\bid="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/button>/g)]
    .map(([, half, id, label, body]) => `${half ?? ""} #${id ?? ""} "${label ?? ""}": ${(body ?? "").replace(/<[^>]*>/g, "")}`);
  return [root, ...halves];
}

// ## A landmark place shows both halves
//
// The switch half names the box and the landmark with its mark; the here half
// names the landmark's folder.
void test("A landmark place shows both halves", (t) => {
  t.check(face({ boxSlug: "test1", boxName: "Seed exchange", place: { dir: "garden", label: "garden" }, landmark: { dir: "garden", label: "Garden", symbol: { glyph: "🌱" } } }), [
    "bbx-place-pill",
    "switch #bbx-nav-place \"Where you are: Garden\": Seed exchange ▸🌱Garden",
    "here #bbx-nav-here \"Here: garden\": garden",
  ]);
  t.end();
});

// ## The box root without a landmark card
//
// There is no here half, and the house mark stands in for a symbol.
void test("The box root without a landmark card", (t) => {
  t.check(face({ boxSlug: "test1", boxName: "Seed exchange", place: { dir: "", label: "Seed exchange" }, landmark: null }), [
    "bbx-place-pill",
    "switch #bbx-nav-place \"Where you are: Seed exchange\": 🏠Seed exchange",
  ]);
  t.end();
});

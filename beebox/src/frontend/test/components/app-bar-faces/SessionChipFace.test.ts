// # The session chip's face
//
// `SessionChipFace` is the chip as drawn. The live chip puts it in its menu's
// trigger; the theme studio renders the same face with fixed props, so a
// theme's nav rules meet the same markup in both.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionChipFace } from "../../../src/components/app-bar-faces/SessionChipFace.js";

globalThis.React = React;

/** `#id "accessible name": visible text`, then the number of drawn marks. */
function face(props: Omit<React.ComponentProps<typeof SessionChipFace>, "onClick" | "ariaProps">): [string, number] {
  const html = renderToStaticMarkup(React.createElement(SessionChipFace, { ...props, onClick: () => {}, ariaProps: { "aria-haspopup": "menu", "aria-expanded": false } }));
  const id = /\bid="([^"]+)"/.exec(html)?.[1] ?? "";
  const label = /\baria-label="([^"]+)"/.exec(html)?.[1] ?? "";
  return [`#${id} "${label}": ${html.replace(/<[^>]*>/g, "")}`, html.match(/<svg\b/g)?.length ?? 0];
}

// ## A titled chat on another model
//
// The settings glyph, "Chat", the model gauge, the session label and the caret.
void test("A titled chat on another model", (t) => {
  t.check(face({ label: "Seed exchange plan", drift: "below", offEngine: true, accessibleName: "Chat: Seed exchange plan · Sonnet" }),
    ["#bbx-nav-session \"Chat: Seed exchange plan · Sonnet\": ChatSeed exchange plan", 3]);
  t.end();
});

// ## A new chat on the box default
//
// No label yet and no gauge: the glyph, "Chat" and the caret.
void test("A new chat on the box default", (t) => {
  t.check(face({ label: null, drift: null, offEngine: false, accessibleName: "Chat menu · Default" }),
    ["#bbx-nav-session \"Chat menu · Default\": Chat", 2]);
  t.end();
});

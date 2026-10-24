// # The voice chip's trigger
//
// `VoiceChipButtonFace` is the chip's button. The live chip puts it in its
// menu's trigger with the current voice state; the theme studio renders the
// same button with fixed props.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipButtonFace } from "../../../src/components/app-bar-faces/VoiceChipButtonFace.js";

globalThis.React = React;

// ## The label names the button
//
// The voice state is the accessible name and the title; the drawing is the
// child.
void test("The label names the button", (t) => {
  const html = renderToStaticMarkup(React.createElement(VoiceChipButtonFace, {
    label: "Voice — taking turns, answers aloud",
    onClick: () => {},
    ariaProps: { "aria-haspopup": "menu", "aria-expanded": false },
    children: React.createElement("span", null, "drawing"),
  }));
  const id = /\bid="([^"]+)"/.exec(html)?.[1];
  const label = /\baria-label="([^"]+)"/.exec(html)?.[1];
  const title = /\btitle="([^"]+)"/.exec(html)?.[1];
  t.check([id, label, title, html.replace(/<[^>]*>/g, "")],
    ["bbx-nav-voice", "Voice — taking turns, answers aloud", "Voice — taking turns, answers aloud", "drawing"]);
  t.end();
});

// # The app bar's row
//
// `AppNavFace` is the bar as drawn: the pill on the left and the right group.
// The live bar fills it with its menus; the theme studio with fixed faces, so
// a theme's `.bbx-app-nav` rules meet the same markup in both.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppNavFace } from "../../../src/components/app-bar-faces/AppNavFace.js";

globalThis.React = React;

// ## The pill leads and the group follows
//
// The nav carries the theme hook; the right group is pushed right and does
// not shrink, so only the pill yields width.
void test("The pill leads and the group follows", (t) => {
  const html = renderToStaticMarkup(React.createElement(AppNavFace, {
    pill: React.createElement("i", null, "pill"),
    children: [React.createElement("b", { key: "a" }, "chip"), React.createElement("b", { key: "b" }, "avatar")],
  }));
  const nav = /^<nav aria-label="Primary" class="(bbx-app-nav)\b/.exec(html)?.[1] ?? "no bbx-app-nav";
  const group = /<div class="([^"]*shrink-0[^"]*)">(.*?)<\/div>/.exec(html);
  t.check([nav, html.indexOf("pill") < html.indexOf("chip"), group?.[1], group?.[2]],
    ["bbx-app-nav", true, "ml-auto flex items-center gap-2 shrink-0", "<b>chip</b><b>avatar</b>"]);
  t.end();
});

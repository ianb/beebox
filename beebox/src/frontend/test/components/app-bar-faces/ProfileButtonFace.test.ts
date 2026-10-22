// # The profile menu's trigger
//
// `ProfileButtonFace` is the avatar button. The live bar puts it in the
// profile menu's trigger; the theme studio renders the same button with a
// fixed user.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileButtonFace } from "../../../src/components/app-bar-faces/ProfileButtonFace.js";

globalThis.React = React;

/** `#id "title": visible text`. */
function face(user: React.ComponentProps<typeof ProfileButtonFace>["user"]): string {
  const html = renderToStaticMarkup(React.createElement(ProfileButtonFace, { user, onClick: () => {}, ariaProps: { "aria-haspopup": "menu", "aria-expanded": false } }));
  const id = /\bid="([^"]+)"/.exec(html)?.[1] ?? "";
  const title = /\btitle="([^"]+)"/.exec(html)?.[1] ?? "";
  return `#${id} "${title}": ${html.replace(/<[^>]*>/g, "")}`;
}

// ## A signed-in user without a picture
//
// The avatar shows the name's initial.
void test("A signed-in user without a picture", (t) => {
  t.check(face({ name: "Dana", email: null }), "#bbx-nav-profile \"Dana\": D");
  t.end();
});

// ## Before sign-in is known
//
// The title says "Menu".
void test("Before sign-in is known", (t) => {
  t.check(face(null), "#bbx-nav-profile \"Menu\": ");
  t.end();
});

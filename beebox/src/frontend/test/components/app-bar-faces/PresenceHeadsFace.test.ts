// # Heads of the others in a chat
//
// `PresenceHeadsFace` draws who else has the chat open. Alone draws nothing,
// so a one-person box sees no change; two others draw two heads; more than two
// draw two heads and a `+N` disc that names the rest.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresenceHeadsFace, type PresenceHead } from "../../../src/components/app-bar-faces/PresenceHeadsFace.js";

globalThis.React = React;

const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };
const odette = { email: "odette@example.com", name: "Odette Marlowe" };
const juni = { email: "juni@example.com", name: "Juniper Marlowe" };
const wren = { email: "wren@example.com", name: "Wren Marlowe" };

/** Each item's title, with the disc's text when it has one. */
function items(people: PresenceHead[]): string[] {
  const html = renderToStaticMarkup(React.createElement(PresenceHeadsFace, { people }));
  return [...html.matchAll(/<li[^>]*title="([^"]*)"[^>]*>(\+\d+)?/g)].map((m) => { const title = m[1] ?? ""; return m[2] === undefined ? title : `${m[2]} ${title}`; });
}

void test("alone draws nothing", (t) => {
  t.check(renderToStaticMarkup(React.createElement(PresenceHeadsFace, { people: [] })), "");
  t.end();
});

void test("two others draw two heads, in the order given", (t) => {
  t.check(items([tomas, odette]), ["Tomas Marlowe is in this chat", "Odette Marlowe is in this chat"]);
  t.end();
});

void test("more than two draw two heads and a disc naming the rest", (t) => {
  t.check(items([tomas, odette, juni, wren]), [
    "Tomas Marlowe is in this chat",
    "Odette Marlowe is in this chat",
    "+2 Also here: Juniper Marlowe, Wren Marlowe",
  ]);
  t.end();
});

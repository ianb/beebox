// # App bar place owners keep their stack position
//
// A page publishes its place to the app bar with `useAppBarPlace`. A chat and a
// focused Browse card can both publish; the newest owner shows, and when Browse
// closes, the bar falls back to the chat's place (`lib/place-stack.ts`).
//
// The chat republishes when its label changes, for example when its landmark
// label loads. That republish must update the chat's entry in place. An earlier
// version cleared the entry in the effect cleanup and published it again as a
// new owner, so a chat whose label changed under a focused Browse card rose
// above it and the pill named the chat (fixed in `e22c56ead`). Only effect
// ordering shows this bug, so this is a DOM doctest.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { mount } from "../helpers/dom-harness.js";
import { createElement as h } from "react";
import { AppBarChromeProvider, useAppBarPlace, useAppBarPublishedPlace } from "../../src/components/app-bar-chrome.js";

function Publisher({ label }: { label: string }) {
  useAppBarPlace({ dir: "", label });
  return null;
}

function Bar() {
  return h("output", null, useAppBarPublishedPlace()?.label ?? "(none)");
}

/** The bar, then the chat's publisher, then Browse's when it is open. */
function page(chat: string, browse: string | null) {
  return h(AppBarChromeProvider, null,
    h(Bar),
    h(Publisher, { key: "chat", label: chat }),
    browse === null ? null : h(Publisher, { key: "browse", label: browse }));
}

// Browse opens over the chat. The chat's label changes; the bar still shows
// Browse. Browse closes; the bar shows the chat's new label:
void test("Browse opens over the chat.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L41
  const view = await mount(page("Kitchen", "Browse: recipes"));
  print(view.container.textContent);
  await view.rerender(page("Kitchen chat", "Browse: recipes"));
  print(view.container.textContent);
  await view.rerender(page("Kitchen chat", null));
  print(view.container.textContent);
  await t.checkText(out.with(await view.unmount()), `Browse: recipes
Browse: recipes
Kitchen chat`);
});

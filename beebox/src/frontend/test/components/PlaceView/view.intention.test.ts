// # The place page leads with the place's intention
//
// A landmark's intention is one line saying what the next piece of work in the
// place is (docs/plans/place-intention.md, Track B). The place page shows it
// first, with an Open action for its prime card and an × that hides it on this
// device until the text changes. These examples render `PlacePage` with a
// loaded payload, as `view.place-page.test.ts` does.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PlacePage } from "../../../src/components/PlaceView/view.js";
import type { PlacePayload } from "../../../src/components/PlaceView/sections.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import type { TextStorage } from "../../../src/lib/dismissed-text.js";

globalThis.React = React;

const LANDMARK = "_content/writing/Writing.landmark.card";
const DISMISS_KEY = `bbx:intention-dismissed:test1:${LANDMARK}`;

function payload(intention: PlacePayload["intention"]): PlacePayload {
  return {
    path: LANDMARK,
    dir: "_content/writing",
    label: "Writing",
    symbol: { glyph: "✍️" },
    prominence: null,
    links: [],
    groups: [],
    depth: 0,
    features: {},
    openers: [],
    intention,
    arrival: LANDMARK,
  };
}

/** Browser storage for one test: `localStorage` is absent under Node, so the page reads this one. */
function withStorage(t: { teardown: (fn: () => void) => void }, items: Record<string, string>): void {
  const map = new Map(Object.entries(items));
  const storage: TextStorage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); } };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  t.teardown(() => { Reflect.deleteProperty(globalThis, "localStorage"); });
}

async function render(intention: PlacePayload["intention"]): Promise<string> {
  const page = React.createElement(PlacePage, { cardPath: LANDMARK, payload: payload(intention), body: "Drafts for the blog.\n", onNavigate: () => {} });
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: page });
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
}

function text(html: string) {
  return html.replace(/<[^>]*(?:>|$)/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

function sectionText(html: string, name: string) {
  const part = html.split('data-place-section="').find((p: string) => p.startsWith(`${name}"`));
  return part === undefined ? null : text(part.slice(part.indexOf(">") + 1).split("data-place-section=")[0] ?? "");
}

function sections(html: string) {
  return [...html.matchAll(/data-place-section="([^"]*)"/g)].map((m) => m[1]);
}

const garden = { text: "Finish the *garden post*: the ending is not written", ref: "_content/writing/Garden_Post.doc.card" };

// ## The line comes first, with Open and the ×
//
// The intention leads the page, above the place summary. Its prime card gets
// an Open action named for the card; the × says what it does.
void test("The intention leads the page, above the place summary.", async (t) => {
  withStorage(t, {});
  const html = await render(garden);
  t.check({
    sections: sections(html),
    line: sectionText(html, "intention"),
    emphasis: html.includes("<em>garden post</em>"),
    dismiss: /aria-label="Hide this until it changes"/.test(html),
  }, {
    sections: ["intention", "summary", "empty"],
    line: "Finish the garden post : the ending is not written Open Garden Post",
    emphasis: true,
    dismiss: true,
  });
});

// A line without a prime card (or whose card is gone, so `ref` is null) has no Open.
void test("A line without a prime card has no Open.", async (t) => {
  withStorage(t, {});
  const html = await render({ text: "Reply to the two feedback emails", ref: null });
  t.check(sectionText(html, "intention"), "Reply to the two feedback emails");
});

// ## Hidden until it changes
//
// The × stored this text, so the line is hidden. When the box writes a
// different line, it shows again without anyone clearing the stored value.
void test("The × stored this text, so the line is hidden.", async (t) => {
  withStorage(t, { [DISMISS_KEY]: "Finish the *garden post*: the ending is not written" });
  const hidden = await render(garden);
  const rewritten = await render({ ...garden, text: "Finish the garden post: Tomas sent two quotes" });
  t.check({ hidden: sections(hidden), rewritten: sections(rewritten), line: sectionText(rewritten, "intention") }, {
    hidden: ["summary", "empty"],
    rewritten: ["intention", "summary", "empty"],
    line: "Finish the garden post: Tomas sent two quotes Open Garden Post",
  });
});

// # The place page
//
// A landmark card renders as the place page: its openers where they can be
// sent, then its links in tiers and each `expand` as a
// labeled group (docs/implemented-plans/landmark-arrival.md, Track C). These examples render
// `PlacePage` with a loaded `landmarks.forDir` payload, the way the
// `PersonView` test renders a person's front.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PlacePage } from "../../../src/components/PlaceView/view.js";
import type { PlacePayload } from "../../../src/components/PlaceView/sections.js";
import { PlaceChatContext, type PlaceChat } from "../../../src/components/openers/place-chat.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import { MaterialContext } from "../../../src/components/ui/material.js";

globalThis.React = React;

function payload(overrides?: Partial<PlacePayload>): PlacePayload {
  return {
    path: "_content/lending/Lending.landmark.card",
    dir: "_content/lending",
    label: "Lending",
    symbol: { glyph: "🤝" },
    prominence: null,
    links: [],
    groups: [],
    depth: 0,
    features: {},
    openers: ["Who has what right now?", "Log a new loan"],
    arrival: "_content/lending/Lending.landmark.card",
    ...overrides,
  };
}

/** Render the page (the Lending place unless `cardPath` says otherwise) inside a router, a query client that never answers, (optionally) a chat, and (optionally) on a card's material, as `PlaceView` puts it. */
async function render({ material, ...props }: Omit<React.ComponentProps<typeof PlacePage>, "cardPath" | "onNavigate" | "onGoToPlace"> & { cardPath?: string; material?: boolean }, chat?: PlaceChat | null) {
  const page = React.createElement(PlacePage, { cardPath: "_content/lending/Lending.landmark.card", onNavigate: () => {}, onGoToPlace: () => {}, ...props });
  const onMaterial = React.createElement(MaterialContext.Provider, { value: material === true }, page);
  const withChat = React.createElement(PlaceChatContext.Provider, { value: chat ?? null }, onMaterial);
  const element = React.createElement(BoxSlugProvider, { boxSlug: "test1", children: withChat });
  const root = createRootRoute({ staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(RouterProvider, { router })));
}

/** The page's visible text, tags (and a trailing cut-off tag) collapsed to single spaces. */
function text(html: string) {
  return html.replace(/<[^>]*(?:>|$)/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** The visible text of one `data-place-section`, up to the next section. */
function sectionText(html: string, name: string) {
  const part = html.split('data-place-section="').find((p: string) => p.startsWith(`${name}"`));
  return part === undefined ? null : text(part.slice(part.indexOf(">") + 1));
}

/** The `data-place-section` names, in page order. */
function sections(html: string) {
  return [...html.matchAll(/data-place-section="([^"]*)"/g)].map((m) => m[1]);
}

const startedLending: PlaceChat = { contextDir: "_content/lending", showsOwnOpeners: false, busy: false, sendOpener: () => "accepted" };

// ## An empty place says so and offers its folder
//
// No links and no groups: "Nothing to show here yet." and a quiet line that
// opens the folder in Browse (docs/implemented-plans/front-door.md, Track E). It does not
// say the folder is empty: the place skips background cards and cards of
// unknown types. It names no path and does not say "card". A place with no
// openers shows no "Start something".
void test("No links and no groups:", async (t) => {
  const html = await render({ payload: payload({ openers: [] }) }, startedLending);
  t.check(({ sections: sections(html), text: text(html) }), {
    sections: [
      "empty",
    ],
    text: "Nothing to show here yet. Tell me about something in the chat and I'll keep it here. Open Lending in Browse",
  });
});

// ## The place summary comes first
//
// The landmark card's body is the place summary (docs/implemented-plans/place-shows-cards.md,
// Track C). It renders as markdown above "Start something" and the tiers.
void test("The landmark card's body is the place summary (docs/implemented-plans/place-s...", async (t) => {
  const html = await render({ payload: payload({
    groups: [{ label: "Also here", count: 1, alsoHere: true, children: [{ ref: "_content/lending/Stove.loan.card", label: null, title: "Camp stove", exists: true, source: "derived" }] }],
  }), body: "The **stove** is with Idris until Friday.\n" }, startedLending);
  t.check(({ sections: sections(html), summary: sectionText(html, "summary") }), {
    sections: [
      "summary",
      "start-something",
      "group",
    ],
    summary: "The stove is with Idris until Friday.",
  });
});

// A blank body shows no summary section, and no "No body content" line.
void test("A blank body shows no summary section, and no \"No body content\" line.", async (t) => {
  const html = await render({ payload: payload({ openers: [] }), body: "  \n\n" });
  t.check(({ sections: sections(html), text: text(html) }), {
    sections: [
      "empty",
    ],
    text: "Nothing to show here yet. Tell me about something in the chat and I'll keep it here. Open Lending in Browse",
  });
});

// A card link in the summary resolves against the landmark's folder and is a
// link the person can follow.
void test("A card link in the summary resolves against the landmark's folder and is a li...", async (t) => {
  const html = await render({ payload: payload({ openers: [] }), body: "Ask [Idris](Idris.person.card) first.\n" });
  t.check(html.match(/<a [^>]*>Idris<\/a>/)?.[0], "<a class=\"bbx-theme-link\" href=\"/test1/views/_content/lending/Idris.person.card\">Idris</a>");
});

// ## Tiers and groups, with an empty group saying "None yet"
//
// A curated link whose card is gone keeps its row, struck through, so the place
// does not silently shrink. Groups render open on this page.
void test("A curated link whose card is gone keeps its row, struck through, so the place...", async (t) => {
  const html = await render({ payload: payload({
    openers: [],
    links: [
      { ref: "_content/lending/List.doc.card", label: null, title: "Lending list", exists: true, source: "derived", prominence: "entry-point" },
      { ref: "_content/lending/Gone.doc.card", label: null, title: "Gone", exists: false, source: "listed" },
    ],
    groups: [{ label: "Every receipt card here", count: 0, children: [] }],
  }) }, startedLending);
  t.check(html, any(String).includes('aria-expanded="true"'));
  t.check(
    ({
      sections: sections(html),
      struck: html.match(/<s>([^<]*)<\/s>/)?.[1],
      text: text(html),
    }),
    {
    sections: [
      "entry-point",
      "pinned",
      "group",
    ],
    struck: "Gone",
    text: "Start here Lending list Pinned Gone Missing Every receipt card here 0 None yet",
  },
  );
});

// ## "Also here" opens the folder from its overflow count
//
// "Also here" lists 10 cards; the rest show as one count that opens the folder
// in Browse. Another group's overflow stays plain text.
void test("\"Also here\" lists 10 cards; the rest show as one count that opens the folder...", async (t) => {
  const tile = (name: string) => ({ ref: `_content/lending/${name}.doc.card`, label: null, title: name, exists: true, source: "derived" as const });
  const ten = Array.from({ length: 10 }, (_, i) => tile(`Card ${i}`));
  const html = await render({ payload: payload({
    openers: [],
    groups: [
      { label: "Every loan card here", count: 60, children: [tile("Loan")] },
      { label: "Also here", count: 30, children: ten, alsoHere: true },
    ],
  }) });
  t.check(
    ({
      moreButtons: [...html.matchAll(/<button[^>]*>([^<]*more)<\/button>/g)].map((m) => m[1]),
      text: text(html),
    }),
    {
    moreButtons: [
      "+20 more",
    ],
    text: "Every loan card here 60 Loan +59 more Also here 30 Card 0 Card 1 Card 2 Card 3 Card 4 Card 5 Card 6 Card 7 Card 8 Card 9 +20 more",
  },
  );
});

// ## An author's group named "Also here" keeps a plain overflow count
//
// The page knows the server's "Also here" group by its `alsoHere` mark, not its
// label, so an expand the author named "Also here" does not open Browse.
void test("The page knows the server's \"Also here\" group by its alsoHere mark, not its l...", async (t) => {
  const html = await render({ payload: payload({
    openers: [],
    groups: [{ label: "Also here", count: 30, children: [{ ref: "_content/lending/Loan.doc.card", label: null, title: "Loan", exists: true, source: "expand" }] }],
  }) });
  t.check(({ buttons: [...html.matchAll(/<button[^>]*>([^<]*more)<\/button>/g)].map((m) => m[1]), text: text(html) }), {
    buttons: [],
    text: "Also here 30 Loan +29 more",
  });
});

// ## A tile shows its card's summary line under the title
//
// A row's `detail` (the card type's `summarize` line) shows under its title,
// so a loan tile says who has it without opening the card. A row without one
// shows the title alone.
void test("A row's detail (the card type's summarize line) shows under its title, so a l...", async (t) => {
  const html = await render({ payload: payload({
    openers: [],
    groups: [{ label: "Also here", count: 2, alsoHere: true, children: [
      { ref: "_content/lending/Stove.loan.card", label: null, title: "Camp stove", detail: "Idris has it · back by 2026-10-17", exists: true, source: "derived" },
      { ref: "_content/lending/Rules.doc.card", label: null, title: "House rules", exists: true, source: "derived" },
    ] }],
  }) });
  t.check(sectionText(html, "group"), "Also here 2 Camp stove Idris has it · back by 2026-10-17 House rules");
});

// ## Outside a chat, "Start something" is hidden
//
// The same place with openers, opened with no chat beside it.
void test("The same place with openers, opened with no chat beside it.", async (t) => {
  t.check(sections(await render({ payload: payload() })), [
    "empty",
  ]);
});

// ## Beside a started chat in the place, the openers are offered
void test("Beside a started chat in the place, the openers are offered", async (t) => {
  const html = await render({ payload: payload() }, startedLending);
  t.check(({ sections: sections(html), start: sectionText(html, "start-something") }), {
    sections: [
      "start-something",
      "empty",
    ],
    start: "Start something Who has what right now? Log a new loan",
  });
});

// While that chat is busy with a turn, the openers wait: they render disabled,
// and enable again once the turn ends.
void test("While that chat is busy with a turn, the openers wait:", async (t) => {
  const disabled = (html: string) => html.match(/<button[^>]*disabled=""/g) ?? [];
  t.check([disabled(await render({ payload: payload() }, { ...startedLending, busy: true })), disabled(await render({ payload: payload() }, startedLending))], [
    [
      '<button type="button" disabled=""',
      '<button type="button" disabled=""',
    ],
    [],
  ]);
});

// ## Beside another place's chat, a button to that place's chat replaces the openers
//
// The button says what it does, and the line under it says the current chat is
// kept (the 2026-10-09 walks read "The open chat is in another place." as an
// error).
void test("The button says what it does, and the line under it says the current chat is...", async (t) => {
  const html = await render({ payload: payload() }, { contextDir: "", showsOwnOpeners: false, busy: false, sendOpener: () => "accepted" });
  t.check(({ sections: sections(html), goTo: sectionText(html, "go-to") }), {
    sections: [
      "go-to",
      "empty",
    ],
    goTo: "Open the Lending chat Your current chat stays in Recent chats.",
  });
});

// ## Two landmarks in one folder
//
// If the folder's landmark is another card, the page names both paths instead of
// showing that card's links as this one's.
void test("If the folder's landmark is another card, the page names both paths instead o...", async (t) => {
  t.check(text(await render({ payload: payload({ path: "_content/lending/Aaa.landmark.card" }) })), "This folder has two landmark cards, _content/lending/Lending.landmark.card and _content/lending/Aaa.landmark.card. The place uses _content/lending/Aaa.landmark.card; keep one landmark card per folder.");
});

// ## The mark and label show only in an embed
//
// In a pane or on its own page the card header already names the place; an
// embedded card has no header, so the page draws the mark and label itself.
void test("In a pane or on its own page the card header already names the place; an embe...", async (t) => {
  t.check(
    ({
      pane: text(await render({ payload: payload({ openers: [] }) })),
      embed: text(await render({ payload: payload({ openers: [] }), heading: true })),
    }),
    {
    pane: "Nothing to show here yet. Tell me about something in the chat and I'll keep it here. Open Lending in Browse",
    embed: "🤝 Lending Nothing to show here yet. Tell me about something in the chat and I'll keep it here. Open Lending in Browse",
  },
  );
});

// ## The root place's count line sits under the summary
//
// On the root place the page shows "3 to do · 1 overdue · 2 questions
// waiting" after the summary and before "Start something"
// (docs/implemented-plans/front-door.md, Track C). The counts come from `PlaceView`;
// `view.root-counts.test.ts` covers when it passes them. A failed count query
// shows "Counts unavailable" with a retry; zero shows no line.
void test("On the root place the page shows the count line after the summary", async (t) => {
  const rootPage = (rootCounts: React.ComponentProps<typeof PlacePage>["rootCounts"]) => render({
    payload: payload({ path: "_content/test1.landmark.card", dir: "", label: "test1" }),
    cardPath: "_content/test1.landmark.card",
    body: "Your box keeps what you tell it.\n",
    ...(rootCounts === undefined ? {} : { rootCounts }),
    onRetryCounts: () => {},
  }, { ...startedLending, contextDir: "" });
  const counted = await rootPage({ onPlateTodos: 3, escalatedTodos: 1, laterTodos: 0, pendingQuestions: 2 });
  const failed = await rootPage("unavailable");
  const zero = await rootPage({ onPlateTodos: 0, escalatedTodos: 0, laterTodos: 0, pendingQuestions: 0 });
  t.check(
    ({
      sections: sections(counted),
      counts: sectionText(counted, "counts"),
      failed: sectionText(failed, "counts"),
      zero: sectionText(zero, "counts"),
    }),
    {
      sections: ["summary", "counts", "start-something", "empty"],
      counts: "3 to do · 1 overdue · 2 questions waiting",
      failed: "Counts unavailable. Retry",
      zero: null,
    },
  );
});

// ## On a card, the page takes the card's ink
//
// The place page draws on the landmark card itself, so its quiet text and
// links use the card's colours (`card-soft`), not the app grey that is dark
// on dark under Gilt or Tempest. Off a material they keep the app grey.
/** The colour classes on the element whose text is exactly `label`. */
function colourOf(html: string, label: string) {
  const tag = [...html.matchAll(/<(?:button|p)[^>]*class="([^"]*)"[^>]*>([^<]*)(?=<)/g)].find((m) => m[2] === label);
  return (tag?.[1] ?? "").split(" ").filter((c) => /^(hover:)?text-(warm|card)-/.test(c));
}

void test("on a card's material the empty-place line and the counts retry take card ink", async (t) => {
  const onCard = await render({ payload: payload({ openers: [] }), rootCounts: "unavailable", onRetryCounts: () => {}, material: true }, startedLending);
  t.check({ browse: colourOf(onCard, "Open Lending in Browse"), retry: colourOf(onCard, "Retry") }, {
    browse: ["text-card-soft", "hover:text-card-ink"],
    retry: ["text-card-soft", "hover:text-card-ink"],
  });
  const offCard = await render({ payload: payload({ openers: [] }), rootCounts: "unavailable", onRetryCounts: () => {} }, startedLending);
  t.check({ browse: colourOf(offCard, "Open Lending in Browse"), retry: colourOf(offCard, "Retry") }, {
    browse: ["text-warm-700", "hover:text-warm-900"],
    retry: ["text-warm-700", "hover:text-warm-900"],
  });
});

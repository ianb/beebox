// A card embed (`![Title](X.card)`) in a place summary shows the card through
// its own viewer, as in a card body. Before, the place page loaded the `.card`
// file as an image and showed "Failed to load"
// (issues/closed/bugs/2026-11-09-place-summary-shows-card-embed-as-broken-image.md).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import { trpc } from "../../../src/lib/trpc/client.js";
import { PlacePage } from "../../../src/components/PlaceView/view.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

void test("a card embed in the summary embeds the card, not an image", async (t) => {
  const payload = {
    path: "_content/lending/Lending.landmark.card",
    dir: "_content/lending",
    label: "Lending",
    symbol: { glyph: "🤝" },
    prominence: null,
    links: [],
    groups: [],
    depth: 0,
    features: {},
    openers: [],
    intention: null,
    arrival: "_content/lending/Lending.landmark.card",
  };
  const page = h(PlacePage, { cardPath: payload.path, payload, body: "![Front page](Front.page.card)\n", onNavigate: () => {}, onGoToPlace: () => {} });
  // A tRPC client that never answers: the embedded card stays loading.
  // No retry, and no garbage-collection timer to keep the process alive.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const client = createTRPCClient<AppRouter>({ links: [() => () => observable(() => () => {})] });
  const view = await mount(h(trpc.Provider, {
    client, queryClient,
    children: h(QueryClientProvider, { client: queryClient }, h(BoxSlugProvider, { boxSlug: "test1", children: page })),
  }));
  t.teardown(() => view.unmount());
  const summary = view.container.querySelector('[data-place-section="summary"]');
  t.check(
    { embeds: summary?.querySelectorAll("[data-card-embed]").length, images: summary?.querySelectorAll("img").length },
    { embeds: 1, images: 0 },
  );
});

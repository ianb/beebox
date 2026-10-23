// # The root place page's count line
//
// The root place page shows what is due and what the box is asking, under the
// summary: "3 to do · 1 overdue · 2 questions waiting"
// (docs/implemented-plans/front-door.md, Track C). It reads `status.navStatus`, the query
// the nav badge reads, so the two agree. A nested place shows no line. When
// the query fails, the page says "Counts unavailable" with a retry, which looks
// different from zero (no line).
//
// These mount the real `PlaceView` in a DOM, with a tRPC link that answers
// `landmarks.forDir` and answers or fails `status.navStatus`.

// First, and bare: React DOM must load after the happy-dom window exists.
import { mount, type Mounted } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@backend/trpc/routers.js";
import { trpc } from "../../../src/lib/trpc/client.js";
import { PlaceView } from "../../../src/components/PlaceView/view.js";
import type { PlacePayload } from "../../../src/components/PlaceView/sections.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import type { RendererProps } from "../../../src/file-type-registry.js";

// React Query tells its observers on a later timer tick by default; tell them
// at once, so a settled cache means a rendered page inside the same `act`.
notifyManager.setScheduler((callback) => { callback(); });

function payload(dir: string, path: string): PlacePayload {
  return {
    path, dir, label: dir === "" ? "test1" : "Lending", symbol: { glyph: "📦" }, prominence: null,
    links: [], groups: [], depth: 0, features: {}, openers: [], arrival: path,
  };
}

type NavAnswer = { counts: { onPlateTodos: number; escalatedTodos: number; laterTodos: number; pendingQuestions: number } } | "fail";

/** Mount `PlaceView` for `place`'s card, answering the place query and `status.navStatus` with `nav`. */
async function render({ place, nav }: { place: PlacePayload; nav: NavAnswer }) {
  const asked: string[] = [];
  const client = createTRPCClient<AppRouter>({
    links: [() => ({ op }) => observable((observer) => {
      asked.push(op.path);
      if (op.path === "landmarks.forDir") {
        observer.next({ result: { type: "data", data: { landmark: place } } });
        observer.complete();
      } else if (op.path === "status.navStatus") {
        if (nav === "fail") observer.error(TRPCClientError.from(new Error("box unreachable")));
        else { observer.next({ result: { type: "data", data: nav } }); observer.complete(); }
      }
      return () => {};
    })],
  });
  // No retry, and no garbage-collection timer to keep the process alive.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const props: RendererProps = { data: { path: place.path, body: "" }, onNavigate: () => {}, mode: "page" };
  const page = h(BoxSlugProvider, { boxSlug: "test1", children: h(PlaceView, props) });
  const root = createRootRoute({ staticData: { title: null }, component: () => page });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const view = await mount(h(trpc.Provider, {
    client, queryClient,
    children: h(QueryClientProvider, { client: queryClient, children: h(RouterProvider, { router }) }),
  }));
  // Settled: the place has loaded, no query is in flight, and on the root
  // place the count query has answered. Each wait runs inside `act`, so the
  // answers render there.
  const navAnswered = () => queryClient.getQueryCache().getAll()
    .some((query) => JSON.stringify(query.queryKey[0]) === '["status","navStatus"]' && query.state.status !== "pending");
  const settle = () => eventually(async () => {
    await view.act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
    return queryClient.isFetching() === 0 && !view.container.textContent.includes("Loading place") && (place.dir !== "" || navAnswered());
  }, { label: "place page settled" });
  await settle();
  return { view, asked, settle };
}

function counts(view: Mounted) {
  return view.container.querySelector('[data-place-section="counts"]')?.textContent ?? null;
}

const root = payload("", "_content/test1.landmark.card");
const someCounts: NavAnswer = { counts: { onPlateTodos: 3, escalatedTodos: 1, laterTodos: 0, pendingQuestions: 2 } };

// ## The root place shows the line
//
// The line sits after the summary and before "Start something"; with no
// workspace to open beside, the counts are plain text.
void test("The root place shows the line", async (t) => {
  const { view } = await render({ place: root, nav: someCounts });
  t.check(counts(view), "3 to do · 1 overdue · 2 questions waiting");
  await view.unmount();
});

// Nothing to do and nothing asked: no line.
void test("Nothing to do and nothing asked: no line.", async (t) => {
  const { view } = await render({ place: root, nav: { counts: { onPlateTodos: 0, escalatedTodos: 0, laterTodos: 0, pendingQuestions: 0 } } });
  t.check(counts(view), null);
  await view.unmount();
});

// ## A nested place shows no line, and does not ask for the counts
void test("A nested place shows no line, and does not ask for the counts", async (t) => {
  const { view, asked } = await render({ place: payload("_content/lending", "_content/lending/Lending.landmark.card"), nav: someCounts });
  t.check({ counts: counts(view), askedForCounts: asked.includes("status.navStatus") }, { counts: null, askedForCounts: false });
  await view.unmount();
});

// ## A failed count query says so, with a retry
//
// Retry asks for the counts again.
void test("A failed count query says so, with a retry", async (t) => {
  const { view, asked, settle } = await render({ place: root, nav: "fail" });
  t.check(counts(view), "Counts unavailable. Retry");
  const retry = view.container.querySelector('[data-place-section="counts"] button');
  if (retry instanceof HTMLElement) await view.act(() => { retry.click(); });
  await settle();
  t.check(asked.filter((path) => path === "status.navStatus"), ["status.navStatus", "status.navStatus"]);
  await view.unmount();
});

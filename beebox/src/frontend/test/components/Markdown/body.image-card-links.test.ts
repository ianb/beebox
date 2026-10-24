// A Markdown link to an image card opens the lightbox instead of the card, and
// the lightbox knows which card each image came from so it can offer "Open
// card". Issue: issues/features/2026-10-07-image-card-link-opens-lightbox.md.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { LightboxProvider, collectImages } from "../../../src/components/LightboxProvider.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";
import { imageLinkSrc } from "../../../src/lib/image-link.js";
import { apiRawImageUrl } from "../../../src/api-core.js";
import type { ViewTarget } from "../../../src/lib/view-url.js";

const source = [
  "See [the receipt](../pics/Receipt.image.card), [the bike](../pics/Bike.image.card), and [notes](Notes.md).",
  "",
].join("\n");

function render(navigated: ViewTarget[], withLightbox: boolean) {
  const markdown = h(Markdown, { onNavigate: (target: ViewTarget) => { navigated.push(target); }, basePath: "_content/trips/Plan.md", children: source });
  return h(BoxSlugProvider, { boxSlug: "test", children: withLightbox ? h(LightboxProvider, null, markdown) : markdown });
}

void test("a link's image URL is the one the image card's own view uses", async (t) => {
  // The lightbox dedupes by src; the card view marks `apiRawImageUrl(getApiBase(), path)`.
  t.check(imageLinkSrc("test", "_content/pics/Receipt.image.card"), apiRawImageUrl("/test/api", "_content/pics/Receipt.image.card"));
  t.check(imageLinkSrc("test", "_content/pics/Receipt.recipe.card"), null);
});

void test("each image-card link is a lightbox image that knows its card", async (t) => {
  const view = await mount(render([], true));
  t.teardown(() => view.unmount());
  t.check(collectImages(view.container), [
    { src: "/test/api/image/_content/pics/Receipt.image.card", alt: "the receipt", caption: undefined, cardPath: "_content/pics/Receipt.image.card" },
    { src: "/test/api/image/_content/pics/Bike.image.card", alt: "the bike", caption: undefined, cardPath: "_content/pics/Bike.image.card" },
  ]);
});

void test("a chat bulk list entry gains the card path from a later link", async (t) => {
  // The first marker for a src keeps its place; chat's bulk list precedes the
  // message's own markers and carries no card path.
  const view = await mount(h("div", null,
    h("script", { type: "application/json", "data-image-list": "" }, JSON.stringify([{ src: "/x.png", alt: "x" }])),
    h("a", { href: "#", "data-image-src": "/x.png", "data-image-card": "_content/x.image.card" }, "x")));
  t.teardown(() => view.unmount());
  t.check(collectImages(view.container), [{ src: "/x.png", alt: "x", caption: undefined, cardPath: "_content/x.image.card" }]);
});

void test("clicking an image-card link opens the lightbox, not the card", async (t) => {
  const navigated: ViewTarget[] = [];
  const view = await mount(render(navigated, true));
  t.teardown(() => view.unmount());
  const links = [...view.container.querySelectorAll("a")];
  const byText = (text: string) => links.find((a) => a.textContent === text);
  await view.act(() => { byText("the bike")?.click(); });
  t.check(navigated, []);
  // An ordinary link still navigates.
  await view.act(() => { byText("notes")?.click(); });
  t.check(navigated, [{ path: "_content/trips/Notes.md", viewer: null, params: {}, viewState: null }]);
});

void test("without a lightbox the link navigates as before", async (t) => {
  const navigated: ViewTarget[] = [];
  const view = await mount(render(navigated, false));
  t.teardown(() => view.unmount());
  const bike = [...view.container.querySelectorAll("a")].find((a) => a.textContent === "the bike");
  await view.act(() => { bike?.click(); });
  t.check(navigated.map((target) => target.path), ["_content/pics/Bike.image.card"]);
});

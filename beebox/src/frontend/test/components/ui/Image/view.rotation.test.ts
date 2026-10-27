// # Image — a rotated photo keeps its overlay on the subject
//
// A quarter turn sizes the outer box to the turned photo's shape, from the
// photo's natural size, and turns the photo and its overlay as one frame. The
// overlay keeps the photo's own percentages and has no transform of its own
// (`issues/closed/bugs/2026-08-21-rotated-image-cards-overflow-and-misplace-bbox.md`).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Image, type ImageRotation } from "../../../../src/components/ui/Image/view.js";
import { BboxOverlay } from "../../../../src/components/ui/BboxOverlay.js";
import { LightboxProvider } from "../../../../src/components/LightboxProvider.js";

// happy-dom loads no pixels, so every img reports itself complete with no
// size; give them the shape of a portrait scan (512×741) as a loaded photo.
Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 512 });
Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 741 });

/**
 * After the photo loads: the style of the element holding the img and the
 * overlay, of the element around that, and of the img and overlay themselves.
 */
async function layers(rotation: ImageRotation): Promise<{ around: string; holder: string; overlayBesideImg: boolean; img: string; overlay: string }> {
  const view = await mount(h(LightboxProvider, null, h(Image, {
    src: `/test/api/files/photo-${String(rotation)}.jpg`,
    alt: "Family",
    size: "lg",
    rotation,
    overlay: h(BboxOverlay, { top: 0, left: 0, width: 25, height: 50 }),
  })));
  const img = view.container.querySelector("img");
  const overlay = view.container.querySelector(".border-primary");
  if (img === null || overlay === null) { const html = view.container.innerHTML; await view.unmount(); throw new Error(`image or overlay missing: ${html}`); }
  const holder = overlay.parentElement;
  const result = {
    around: holder?.parentElement?.getAttribute("style") ?? "",
    holder: holder?.getAttribute("style") ?? "",
    overlayBesideImg: holder === img.parentElement,
    img: img.getAttribute("style") ?? "",
    overlay: overlay.getAttribute("style") ?? "",
  };
  await view.unmount();
  return result;
}

void test("a quarter turn takes the turned shape and turns the overlay with the photo", async (t) => {
  t.check(await layers(270), {
    // happy-dom's style parser drops the `min()` width; the next test reads it from the markup.
    around: "aspect-ratio: 741 / 512;",
    holder: "width: 69.09581646423752%; height: 144.7265625%; transform: translate(-50%, -50%) rotate(270deg);",
    overlayBesideImg: true,
    img: "",
    overlay: "top: 0%; left: 0%; width: 25%; height: 50%;",
  });
});

// Before the photo loads its shape is unknown and the box is square; the width
// caps the turned shape at the size's height (32rem for a card's photo).
void test("before the photo loads, the quarter-turn box is square and capped", async (t) => {
  const html = renderToStaticMarkup(h(LightboxProvider, null, h(Image, { src: "/test/api/files/unloaded.jpg", alt: "Family", size: "lg", rotation: 90 })));
  t.check(html.match(/<div class="relative" style="[^"]*">/)?.[0], '<div class="relative" style="width:min(100%, 100%, calc(32rem * 1 / 1));aspect-ratio:1 / 1">');
});

void test("a half turn rotates the overlay wrapper, not the img alone", async (t) => {
  t.check(await layers(180), {
    around: "",
    holder: "transform: rotate(180deg);",
    overlayBesideImg: true,
    img: "",
    overlay: "top: 0%; left: 0%; width: 25%; height: 50%;",
  });
});

// # The phone landmark search overlay keeps the page behind it inert
//
// On a phone the landmark search opens as a full-screen overlay portaled into
// <body> that says aria-modal. It is not a <dialog> (it sizes itself to the
// visual viewport for the iOS keyboard), so it makes the rest of <body> inert
// itself while open, and restores it when search closes.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { LandmarkList, type SwitchLandmark } from "../../../src/components/AppNav/PlacePill-landmarks.js";

const landmarks: SwitchLandmark[] = Array.from({ length: 21 }, (_, i) => ({
  path: `place-${i}/Place.landmark.card`,
  dir: `place-${i}`,
  label: `Place ${i}`,
  symbol: null,
  freshCount: 0,
}));

function list(searchOpen: boolean) {
  return h(LandmarkList, {
    landmarks,
    failed: false,
    onRetry: () => {},
    boxSlug: "test1",
    currentDir: null,
    onSelectLandmark: () => {},
    searchOpen,
    onCancelSearch: () => {},
  });
}

void test("while the phone search overlay is open, the rest of <body> is inert", async (t) => {
  const realMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
  // A phone-width viewport: the overlay branch.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  t.teardown(() => {
    if (realMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
    else Object.defineProperty(window, "matchMedia", realMatchMedia);
  });
  const outside = document.createElement("div");
  document.body.append(outside);
  t.teardown(() => outside.remove());

  const view = await mount(list(true));
  const overlay = document.querySelector("section[aria-modal=true]");
  const open = {
    overlayInBody: overlay?.parentElement === document.body,
    overlayInert: overlay?.hasAttribute("inert") ?? null,
    outsideInert: outside.hasAttribute("inert"),
    appInert: view.container.closest("body > *")?.hasAttribute("inert") ?? null,
  };
  await view.rerender(list(false));
  const closed = { outsideInert: outside.hasAttribute("inert"), overlayPresent: document.querySelector("section[aria-modal=true]") !== null };
  await view.unmount();

  t.check({ open, closed }, {
    open: { overlayInBody: true, overlayInert: false, outsideInert: true, appInert: true },
    closed: { outsideInert: false, overlayPresent: false },
  });
});

// # The image lightbox is a fullscreen modal dialog
//
// ImageLightbox renders through ModalDialog layout="fullscreen": a native
// modal <dialog> named by the image and its position, with focus starting on
// the close button (not the full-screen backdrop button). The arrow keys step
// through the images and Escape closes; focus returns to the opener.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ImageLightbox, type LightboxImage } from "../../src/components/ImageLightbox.js";

const images: LightboxImage[] = [
  { src: "/a.png", alt: "First" },
  { src: "/b.png", alt: "" },
];

function key(name: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

void test("opens as a named modal on the close button; arrows step, Escape closes", async (t) => {
  const opener = document.createElement("button");
  document.body.append(opener);
  t.teardown(() => opener.remove());
  opener.focus();
  const events: string[] = [];
  const render = (index: number) => h(ImageLightbox, {
    images,
    index,
    onIndexChange: (next) => events.push(`index ${next}`),
    onClose: () => events.push("close"),
  });
  const view = await mount(render(0));
  const dialog = document.querySelector("dialog");
  const opened = { open: dialog?.open, label: dialog?.getAttribute("aria-label"), focus: document.activeElement?.id };
  await view.act(() => { key("ArrowRight"); key("ArrowLeft"); });
  await view.rerender(render(1));
  const second = document.querySelector("dialog")?.getAttribute("aria-label");
  await view.act(() => { key("Escape"); });
  await view.unmount();
  t.check({ opened, second, events, focusAfter: document.activeElement === opener }, {
    opened: { open: true, label: "First (1 of 2)", focus: "bbx-lightbox-close" },
    second: "Image (2 of 2)",
    events: ["index 1", "index 1", "close"],
    focusAfter: true,
  });
});

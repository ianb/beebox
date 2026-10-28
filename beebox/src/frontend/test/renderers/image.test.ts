// # Image — chat media uses natural proportions
//
// Chat images retain their intrinsic aspect ratio, bounded by the available
// width and 70vh maximum height. The scroll controller compensates load-time reflow.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LightboxProvider } from "../../src/components/LightboxProvider.js";
import { Image } from "../../src/components/ui/Image/view.js";

globalThis.React = React;

function render(size: "chat" | "sm", caption?: string): string {
  const image = React.createElement(Image, {
    src: "/test/api/files/example.png",
    lightboxSrc: "/test/api/files/example.png",
    alt: "Example",
    size,
    lightbox: true,
    caption,
  });
  return renderToStaticMarkup(React.createElement(LightboxProvider, null, image));
}

function renderResponsive(): string {
  const image = React.createElement(Image, {
    src: "/test/api/images/example.png?width=480",
    srcSet: "/test/api/images/example.png?width=480 480w, /test/api/images/example.png?width=960 960w",
    sizes: "(max-width: 640px) 100vw, 512px",
    lightboxSrc: "/test/api/files/example.png",
    alt: "Example",
    size: "chat",
    lightbox: true,
  });
  return renderToStaticMarkup(React.createElement(LightboxProvider, null, image));
}

const BUTTON = "<button type=\"button\" aria-label=\"Example (click to zoom)\" class=\"block border-0 bg-transparent p-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent\">";

// ## Chat images use maximum dimensions without a forced frame
void test("Chat images use maximum dimensions without a forced frame", async (t) => {
  await t.checkText(
    render("chat"),
    `${BUTTON}<img src="/test/api/files/example.png" alt="Example" class="max-w-full max-h-[70vh] rounded m-0" data-image-src="/test/api/files/example.png" data-image-alt="Example"/></button>`,
  );
});

// ## Caption wrappers fit the image instead of filling the transcript width
void test("Caption wrappers fit the image instead of filling the transcript width", async (t) => {
  await t.checkText(
    render("chat", "A caption"),
    `<figure class="inline-flex flex-col items-center">${BUTTON}<img src="/test/api/files/example.png" alt="Example" class="max-w-full max-h-[70vh] rounded m-0" data-image-src="/test/api/files/example.png" data-image-alt="Example" data-image-caption="A caption"/></button><figcaption class="mt-1 max-w-full text-xs text-card-soft italic text-center">A caption</figcaption></figure>`,
  );
});

// ## Small images keep their content-sized presentation
//
// User-message attachment thumbnails use `size="sm"`; changing the ordinary
// Markdown presentation must not enlarge those thumbnails.
void test("User-message attachment thumbnails use size=\"sm\"; changing the ordinary Markd...", async (t) => {
  await t.checkText(
    render("sm"),
    `${BUTTON}<img src="/test/api/files/example.png" alt="Example" class="max-w-xs max-h-64 rounded m-0" data-image-src="/test/api/files/example.png" data-image-alt="Example"/></button>`,
  );
});

// ## Responsive display variants retain the original lightbox source
void test("Responsive display variants retain the original lightbox source", async (t) => {
  await t.checkText(
    renderResponsive(),
    `${BUTTON}<img src="/test/api/images/example.png?width=480" srcSet="/test/api/images/example.png?width=480 480w, /test/api/images/example.png?width=960 960w" sizes="(max-width: 640px) 100vw, 512px" alt="Example" class="max-w-full max-h-[70vh] rounded m-0" data-image-src="/test/api/files/example.png" data-image-alt="Example"/></button>`,
  );
});

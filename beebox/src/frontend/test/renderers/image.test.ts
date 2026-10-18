// # Image — chat media uses natural proportions
//
// Chat images retain their intrinsic aspect ratio, bounded by the available
// width and 70vh maximum height. The scroll controller compensates load-time reflow.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LightboxProvider } from "../../src/components/LightboxProvider.js";
import { Image } from "../../src/components/ui/Image.js";

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

// ## Chat images use maximum dimensions without a forced frame
void test("Chat images use maximum dimensions without a forced frame", async (t) => {
  // doctest:L43
  const chat = render("chat");
  const chatImg = chat.match(/<img[^>]*class="([^"]*)"/)?.[1] ?? "";
  t.check([chatImg.split(" ").includes("w-full"), chatImg.split(" ").includes("h-[70vh]"), chatImg.includes("max-w-full"), chatImg.includes("max-h-[70vh]")].join(" "), "false false true true");

  // doctest:L48
  const chatButton = chat.match(/<button[^>]*class="([^"]*)"/)?.[1] ?? "";
  await t.checkText(chatButton.split(" ").includes("w-full"), "false");
});

// ## Caption wrappers fit the image instead of filling the transcript width
void test("Caption wrappers fit the image instead of filling the transcript width", async (t) => {
  // doctest:L56
  const captioned = render("chat", "A caption");
  await t.checkText(captioned.includes('<figure class="inline-flex flex-col items-center"'), "true");
});

// ## Small images keep their content-sized presentation
//
// User-message attachment thumbnails use `size="sm"`; changing the ordinary
// Markdown presentation must not enlarge those thumbnails.
void test("User-message attachment thumbnails use size=\"sm\"; changing the ordinary Markd...", async (t) => {
  // doctest:L67
  const small = render("sm");
  t.check([small.includes("max-w-xs"), small.includes("max-h-64"), small.includes("h-[70vh]")].join(" "), "true true false");
});

// ## Responsive display variants retain the original lightbox source
void test("Responsive display variants retain the original lightbox source", async (t) => {
  // doctest:L75
  const responsive = renderResponsive();
  await t.checkText(responsive.includes('data-image-src="/test/api/files/example.png"'), "true");
});

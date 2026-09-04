# Image — chat media reserves its presentation frame

Ordinary Markdown images and embedded image cards use `size="chat"`. That
presentation is a stable, viewport-relative media frame: it must occupy its
intended height before the browser has fetched or decoded the image, with
unusual aspect ratios contained inside the frame rather than changing layout.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LightboxProvider } from "../../../src/frontend/src/components/LightboxProvider.js";
import { Image } from "../../../src/frontend/src/components/ui/Image.js";

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
```

## Chat images reserve the existing 70vh presentation before decode

The concrete height, full-width frame, and `object-contain` all belong on the
rendered image element. A mere `max-height` would still leave its pre-decode
height at zero.

```ts
const chat = render("chat");
const chatImg = chat.match(/<img[^>]*class="([^"]*)"/)?.[1] ?? "";
[chatImg.split(" ").includes("w-full"), chatImg.split(" ").includes("h-[70vh]"), chatImg.split(" ").includes("object-contain"), chatImg.includes("max-h-[70vh]")].join(" ")
=> true true true false

const chatButton = chat.match(/<button[^>]*class="([^"]*)"/)?.[1] ?? "";
chatButton.split(" ").includes("w-full")
=> true
```

## A captioned chat image keeps the full-width frame

The figure becomes the outer layout box when a caption is present. It must be
full-width too, or its lightbox button would shrink to the image's unknown
intrinsic width and change geometry after decode.

```ts
const captioned = render("chat", "A caption");
captioned.includes('<figure class="inline-flex flex-col items-center w-full"')
=> true
```

## Small images keep their content-sized presentation

User-message attachment thumbnails use `size="sm"`; reserving the ordinary
Markdown media frame must not turn those into full-screen letterboxed images.

```ts
const small = render("sm");
[small.includes("max-w-xs"), small.includes("max-h-64"), small.includes("h-[70vh]")].join(" ")
=> true true false
```

## Responsive display variants retain the original lightbox source

```ts
const responsive = renderResponsive();
[responsive.includes('480 480w, /test/api/images/example.png?width=960 960w'), responsive.includes('sizes="(max-width: 640px) 100vw, 512px"'), responsive.includes('data-image-src="/test/api/files/example.png"')].join(" ")
=> true true true
```

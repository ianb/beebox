# Image — chat media uses natural proportions

Chat images retain their intrinsic aspect ratio, bounded by the available
width and 70vh maximum height. The scroll controller compensates load-time reflow.

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

## Chat images use maximum dimensions without a forced frame

```ts
const chat = render("chat");
const chatImg = chat.match(/<img[^>]*class="([^"]*)"/)?.[1] ?? "";
[chatImg.split(" ").includes("w-full"), chatImg.split(" ").includes("h-[70vh]"), chatImg.includes("max-w-full"), chatImg.includes("max-h-[70vh]")].join(" ")
=> false false true true

const chatButton = chat.match(/<button[^>]*class="([^"]*)"/)?.[1] ?? "";
chatButton.split(" ").includes("w-full")
=> false
```

## Caption wrappers fit the image instead of filling the transcript width

```ts
const captioned = render("chat", "A caption");
captioned.includes('<figure class="inline-flex flex-col items-center"')
=> true
```

## Small images keep their content-sized presentation

User-message attachment thumbnails use `size="sm"`; changing the ordinary
Markdown presentation must not enlarge those thumbnails.

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

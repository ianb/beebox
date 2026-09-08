# Quote presentation hooks

`QuoteInline` and `QuoteBlock` keep their provenance-bearing semantics while
exposing stable theme roles. An explicit treatment is data, not a CSS class;
the active theme decides how that named request looks.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeQuoteComponents } from "../../src/frontend/src/components/Quote.js";

globalThis.React = React;

const { QuoteInline, QuoteBlock } = makeQuoteComponents({ onNavigate: () => undefined });
```

## Inline quotes preserve punctuation, attribution, and inline markup

```ts
const inline = renderToStaticMarkup(React.createElement(
  QuoteInline,
  { from: "A participant" },
  React.createElement("em", null, "exact words"),
));
inline.includes('class="bbx-quote bbx-quote-inline"')
=> true

inline.includes("<em>exact words</em>")
=> true

inline.includes('<span class="bbx-quote-mark">“</span>') && inline.includes('<span class="bbx-quote-mark">”</span>')
=> true

inline.includes('<span class="bbx-quote-attribution"> — <span>A participant</span></span>')
=> true
```

## Block treatment and provenance stay on the quote figure

```ts
const block = renderToStaticMarkup(React.createElement(
  QuoteBlock,
  { from: "A participant", treatment: "layered" },
  React.createElement("p", null, "Keep the example close."),
));
block.includes('<figure class="bbx-quote bbx-quote-block" data-from="A participant" data-treatment="layered">')
=> true

block.includes('<blockquote class="bbx-quote-body"><p>Keep the example close.</p></blockquote>')
=> true

block.includes('<figcaption class="bbx-quote-attribution">— <span>A participant</span></figcaption>')
=> true
```

## Person refs preserve navigation and take the themed link role

```ts
const linked = renderToStaticMarkup(React.createElement(
  QuoteBlock,
  { from: "people/rina" },
  "Exact words.",
));
linked.includes('<button type="button" class="bbx-theme-link">rina</button>')
=> true
```

## Omitted treatment leaves the theme default in control

```ts
const defaulted = renderToStaticMarkup(React.createElement(QuoteBlock, null, "Theme default."));
defaulted.includes("data-treatment")
=> false
```

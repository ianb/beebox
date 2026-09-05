# Browsing a landmarked directory leads with its curated navigation

The browse sidebar renders the current directory's resolved landmark payload
before the raw directory entries. Internal links remain in Browse through its
navigation callback; URL-shaped links stay ordinary external anchors.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowseLandmarkHeader } from "../../src/frontend/src/pages/browse/components/BrowseLandmarkHeader.js";
import { BrowseSidebarList } from "../../src/frontend/src/pages/browse/components/BrowseSidebarList.js";

globalThis.React = React;

const landmark = {
  path: "Box.landmark.card",
  dir: "",
  label: "Box",
  symbol: "📦",
  symbolSrc: null,
  depth: 0,
  features: {},
  links: [
    { ref: "_content/Welcome.memo.card", label: "Welcome", title: "Welcome", exists: true },
    { ref: "https://example.com/guide", label: "Guide", title: "Guide", exists: false },
    { ref: "_content/Missing.memo.card", label: null, title: "Missing", exists: false },
  ],
  groups: [],
};

const header = renderToStaticMarkup(React.createElement(BrowseLandmarkHeader, {
  landmark,
  boxSlug: "test1",
  onNavigate: () => {},
}));
```

The section owns its landmark and names the place. A resolved in-box link is a
button for the page callback, an external ref is an anchor, and a missing card
is visibly unavailable.

```ts
[
  header.includes('aria-label="Box landmark"'),
  header.includes('<h2'),
  header.includes('aria-label="Open Box landmark details"'),
  header.includes('>Welcome<'),
  header.includes('<button type="button"'),
  header.includes('href="https://example.com/guide"'),
  header.includes('target="_blank"'),
  header.includes('>Missing<'),
].join(" ")
=> true true true true true true true true
```

When a landmark has no label, the header falls back to the boxholder display
form of its path — bare for a `_content` path, `<AreaLabel>:...` for a
machinery area (`display-path.ts`).

```ts continue
const unlabeledContentHeader = renderToStaticMarkup(React.createElement(BrowseLandmarkHeader, {
  landmark: { ...landmark, label: "", path: "_content/recipes/Box.landmark.card" },
  boxSlug: "test1",
  onNavigate: () => {},
}));

const unlabeledMachineryHeader = renderToStaticMarkup(React.createElement(BrowseLandmarkHeader, {
  landmark: { ...landmark, label: "", path: "_bookkeeping/jobs/Box.landmark.card" },
  boxSlug: "test1",
  onNavigate: () => {},
}));

[
  unlabeledContentHeader.includes(">recipes/Box.landmark.card<"),
  unlabeledMachineryHeader.includes(">Bookkeeping:jobs/Box.landmark.card<"),
].join(" ")
=> true true
```

The landmark card itself is not repeated in the raw listing once the header
represents it. Other cards and files remain present.

```ts
const listing = renderToStaticMarkup(React.createElement(BrowseSidebarList, {
  data: {
    dirs: [],
    cards: [
      { relativePath: "Box.landmark.card", name: "Box", type: "landmark", hasAttachments: false },
      { relativePath: "briefing.memo.card", name: "briefing", type: "memo", hasAttachments: false },
    ],
    files: [{ relativePath: "MAP.md", name: "MAP.md" }],
  },
  dirPath: "",
  loading: false,
  onNavigate: () => {},
  selectedFilePath: null,
  onFileContextMenu: () => {},
  omitCardPath: landmark.path,
}));
[
  listing.includes("Box.landmark.card"),
  listing.includes("briefing"),
  listing.includes("MAP.md"),
].join(" ")
=> false true true
```

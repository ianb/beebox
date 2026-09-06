# Browse's compact/raw listing modes

`BrowseSidebarList`'s `mode` prop (`docs/implemented-plans/card-prominence.md`, Track C):
compact leads with `foldListing`'s `lead` tier and folds the rest behind one
"N more" disclosure; raw ignores prominence and renders today's flat
listing. A listing with nothing prominent renders identically in both
modes — no disclosure appears.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowseSidebarList } from "../../src/frontend/src/pages/browse/components/BrowseSidebarList.js";

globalThis.React = React;

const mixedData = {
  background: false,
  dirs: [
    {
      name: "Cookbook",
      fileCount: 2,
      summary: { hasEntryPoint: false, primaryCount: 1, background: false },
      landmark: { label: "Cookbook", symbol: { glyph: "🍳" } },
    },
    { name: "Logs", fileCount: 3, summary: { hasEntryPoint: false, primaryCount: 0, background: true } },
  ],
  cards: [
    { relativePath: "Plan.memo.card", name: "Plan", type: "memo", hasAttachments: false, prominence: "entry-point" },
    { relativePath: "Notes.memo.card", name: "Notes", type: "memo", hasAttachments: false, prominence: "ordinary" },
    { relativePath: "Scratch.memo.card", name: "Scratch", type: "memo", hasAttachments: false, prominence: "background" },
  ],
  files: [{ relativePath: "readme.txt", name: "readme.txt" }],
};

function renderList(data: unknown, mode: "compact" | "raw"): string {
  return renderToStaticMarkup(React.createElement(BrowseSidebarList, {
    data,
    dirPath: "",
    loading: false,
    onNavigate: () => {},
    selectedFilePath: null,
    onFileContextMenu: () => {},
    mode,
  }));
}
```

## Compact: the entry-point card and the primary-carrying directory lead, with its landmark identity; everything else folds behind "4 more"

```ts
const compact = renderList(mixedData, "compact");
[
  compact.includes(">Plan<"),
  compact.includes("Cookbook"),
  compact.includes("🍳"),
  compact.includes("4 more"),
  // The disclosure is collapsed by default — folded rows aren't in the
  // initial markup at all, not merely hidden.
  compact.includes(">Notes<"),
].join(" ")
=> true true true true false
```

## Raw: every item renders flat, prominence ignored, no disclosure

```ts
const raw = renderList(mixedData, "raw");
[
  raw.includes(">Plan<"),
  raw.includes(">Notes<"),
  raw.includes(">Scratch<"),
  raw.includes("Cookbook"),
  raw.includes("Logs"),
  raw.includes("readme.txt"),
  raw.includes("more"),
].join(" ")
=> true true true true true true false
```

## Nothing prominent: compact renders identically to raw, no disclosure

```ts
const plainData = {
  background: false,
  dirs: [{ name: "Sub", fileCount: 0, summary: { hasEntryPoint: false, primaryCount: 0, background: false } }],
  cards: [{ relativePath: "X.memo.card", name: "X", type: "memo", hasAttachments: false, prominence: "ordinary" }],
  files: [],
};
const plainCompact = renderList(plainData, "compact");
[
  plainCompact.includes(">X<"),
  plainCompact.includes("Sub"),
  plainCompact.includes("more"),
].join(" ")
=> true true false
```

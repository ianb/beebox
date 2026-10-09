# Image card list row: the path follows the list's choice

`src/schemas/image/list-entry.tsx` draws an image card's list row: a thumbnail,
the title, and the file path under it. The Plate shows titles only, so its rows
pass `hidePath` to `FileEntry`. An image card renders through this custom list
entry, not `FileEntry`'s default slot, and it used to print the path anyway
(`issues/closed/bugs/2026-10-09-plate-card-rows-show-file-paths.md`).
`FileEntry` now passes `hidePath` to a custom list entry too.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageCardListEntry } from "../../../schemas/image/list-entry.js";

globalThis.React = React;

// No `attrs.filename`: the thumbnail URL needs the browser's API base, and the
// path line does not depend on it.
const data = { path: "_content/kitchen/Shelf photo.image.card", title: "Shelf photo" };

function shows(props: { compact: boolean; hidePath: boolean }) {
  const html = renderToStaticMarkup(React.createElement(ImageCardListEntry, { data, ...props }));
  return { title: html.includes(">Shelf photo<"), path: html.includes(`>${data.path}<`) };
}
```

## A list that hides paths shows the title alone

```ts
shows({ compact: false, hidePath: true })
=> { title: true, path: false }
```

## Other lists keep the path, unless the row is compact

```ts
[shows({ compact: false, hidePath: false }), shows({ compact: true, hidePath: false })]
=> [{ title: true, path: true }, { title: true, path: false }]
```

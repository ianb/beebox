# The card header title

`title:` wins; a landmark without one is headed by its place's
`navigation.label`; a named entity (person, place) by its `name:`; otherwise
the filename stands in.

```ts setup
import { cardTitle } from "../../../../src/components/themes/ThemedFileCard/view.js";
```

```ts
cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { name: "Dr. Rosa Quill" } })
=> Dr. Rosa Quill

cardTitle({ path: "_content/people/Mom.person.card", frontmatter: { title: "Mom", name: "Dr. Rosa Quill" } })
=> Mom

cardTitle({ path: "_content/people/Rosa_Quill.person.card", frontmatter: {} })
=> Rosa Quill
```

A landmark card is the place page, so it is headed by the place's name, the
label the place pill and the "Go to" buttons use. The 2026-10-09 walks saw
"Box" and "Intro Chemistry" (filenames) above pages the rest of the app called
by the box's name and "Chemistry".

```ts
cardTitle({ path: "_content/Box.landmark.card", frontmatter: { navigation: { label: "Kitchen" } } })
=> Kitchen

cardTitle({ path: "_content/chem/Intro_Chemistry.landmark.card", frontmatter: { navigation: { label: "Chemistry", openers: [] } } })
=> Chemistry
```

A landmark with no label (a destinations-only one) falls back to its filename.

```ts
cardTitle({ path: "_content/inbox/Inbox.landmark.card", frontmatter: { navigation: { label: "  " } } })
=> Inbox
```

## The card type's summary line sits under the title

The card page shows the line the card's type writes about itself
(`card.get` `detail`) under the title, inside the header; without one, the
header holds the title alone.

```ts
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveCardTheme } from "@shared/card-theme/core";
import { CardThemeSurface } from "../../../../src/components/themes/ThemedFileCard/CardThemeSurface.js";

globalThis.React = React;
const theme = resolveCardTheme({ path: "_content/Solder.record.card", type: "record", cardChoice: undefined, typeDefault: undefined, presentation: { status: "absent" } });
const header = (detail) => {
  const html = renderToStaticMarkup(React.createElement(CardThemeSurface, {
    theme, title: "Solder", detail, symbol: null, boxSlug: "test1", mode: "page", properties: null,
  }, React.createElement("p", null, "Front")));
  return /<header[^>]*>(.*?)<\/header>/s.exec(html)?.[1].replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
};
[header("Tray 3 · 2 spools"), header(undefined)]
=> ["|Solder|Tray 3 · 2 spools|", "|Solder|"]
```

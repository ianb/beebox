# Document title composition

`composeDocumentTitle` (`lib/document-title.ts`) joins the two halves of a
browser tab's title. The page half comes first because browsers truncate tabs
to roughly twenty characters, and the page is what distinguishes two tabs on
the same box.

```ts setup
import { composeDocumentTitle } from "../../../src/frontend/src/lib/document-title.js";
```

## Page and box, in that order

The app's name is not in the title. The favicon already identifies the app,
and a third segment would never survive truncation.

```ts
composeDocumentTitle({ page: "Grocery planning", box: "Notes" })
=> Grocery planning — Notes

composeDocumentTitle({ page: "Settings", box: "Notes" })
=> Settings — Notes
```

## Outside a box, the app name takes the second slot

`/auth/login` and `/auth/setup` have no box to name, so this is the only place
`Callback Box` appears in a title.

```ts
composeDocumentTitle({ page: "Sign in", box: null })
=> Sign in — Callback Box
```

## A route that names nothing leaves the box alone

Layouts and redirect-only routes declare `title: null`. Their title is just
the box — and with no box either (the box-selection landing at `/`), the app
name is all that is left.

```ts
composeDocumentTitle({ page: null, box: "Notes" })
=> Notes

composeDocumentTitle({ page: null, box: null })
=> Callback Box
```

## Blank and absent are the same thing

A page publishing an empty or whitespace-only title is publishing nothing —
it falls back the same way a null does, rather than titling a tab with a
dangling separator.

```ts
[
  composeDocumentTitle({ page: "   ", box: "Notes" }),
  composeDocumentTitle({ page: "Settings", box: "" }),
  composeDocumentTitle({ page: undefined, box: undefined }),
].join(" | ")
=> Notes | Settings — Callback Box | Callback Box
```

## Surrounding whitespace is trimmed

A card title read from frontmatter can carry it.

```ts
composeDocumentTitle({ page: "  Roast chicken  ", box: " Kitchen " })
=> Roast chicken — Kitchen
```

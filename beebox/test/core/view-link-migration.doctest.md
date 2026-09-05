# view-link-migration

Rewrite stored markdown/card content off the retired `view:` scheme onto plain
box paths, dropping the `?zoom` flag and preserving every other query param.

```ts setup
import { rewriteViewTarget, rewriteViewLinksInText } from "../../src/core/views/link-migration.js";
```

## rewriteViewTarget (a single URL after the `view:` prefix)

A bare path is unchanged; `?zoom` is stripped; `?view=` and other params survive:

```ts
JSON.stringify([
  rewriteViewTarget("store/notes/Plan.doc.card"),
  rewriteViewTarget("store/notes/meeting.md?zoom"),
  rewriteViewTarget("store/x.card?view=Source"),
  rewriteViewTarget("store/f.figure.card?size=300&zoom"),
  rewriteViewTarget("store/x.card?zoom&molecule=H2O2"),
])
=> ["store/notes/Plan.doc.card","store/notes/meeting.md","store/x.card?view=Source","store/f.figure.card?size=300","store/x.card?molecule=H2O2"]
```

## rewriteViewLinksInText (a whole document)

Links and image embeds both migrate; a leading `/` is preserved; plain paths and
external URLs are left byte-identical:

```ts
const src = [
  "A link [the plan](view:store/notes/Plan.doc.card) and an embed",
  "![fig](view:store/figures/F.figure.card?size=160).",
  "Zoomed: [notes](view:store/notes/meeting.md?zoom).",
  "Already fine: [x](store/y.card) and ![img](/store/a.png) and [ext](https://e.org).",
].join("\n");
const { text, count } = rewriteViewLinksInText(src);
print(String(count));
text
=>
3
A link [the plan](store/notes/Plan.doc.card) and an embed
![fig](store/figures/F.figure.card?size=160).
Zoomed: [notes](store/notes/meeting.md).
Already fine: [x](store/y.card) and ![img](/store/a.png) and [ext](https://e.org).
```

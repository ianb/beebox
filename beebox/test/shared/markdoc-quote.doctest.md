# Markdoc `{% quote %}` attribution

The `from` attribute survives the shared Markdoc transform so renderers can
distinguish a third party's exact words from an unattributed user quote.

```ts setup
import Markdoc, { Tag } from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config.js";

function quoteTag(src: string): Tag {
  const tree = Markdoc.transform(Markdoc.parse(src), markdocConfig) as Tag;
  const paragraph = tree.children[0] as Tag;
  return paragraph.children[0] as Tag;
}
```

## Third-party attribution is preserved

```ts
const attributed = quoteTag('{% quote from="Rina Patel, studio owner" %}Exact words.{% /quote %}');
`${attributed.name}:${attributed.attributes["from"]}`
=>
QuoteInline:Rina Patel, studio owner
```

## Existing unattributed quotes remain valid

```ts
const unattributed = quoteTag("{% quote %}The user's exact words.{% /quote %}");
`${unattributed.name}:${String(unattributed.attributes["from"])}`
=>
QuoteInline:undefined
```

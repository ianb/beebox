# Markdoc `{% quote %}` attribution

The `from` attribute survives the shared Markdoc transform so renderers can
distinguish a third party's exact words from an unattributed user quote.

```ts setup
import Markdoc, { type Tag } from "@markdoc/markdoc";
import { lintBodyMarkdoc } from "../../src/core/body-markdoc-lint.js";
import { markdocConfig } from "../../src/shared/markdoc-config.js";

function isTag(value: unknown): value is Tag {
  return typeof value === "object" && value !== null && "name" in value;
}

function quoteTag(src: string): Tag {
  const tree = Markdoc.transform(Markdoc.parse(src), markdocConfig) as Tag;
  const paragraph = tree.children[0] as Tag;
  for (const child of paragraph.children) {
    if (isTag(child) && child.name === "QuoteInline") return child;
  }
  throw new Error("No inline quote in transformed tree");
}

function blockQuoteTag(src: string): Tag {
  const tree = Markdoc.transform(Markdoc.parse(src), markdocConfig) as Tag;
  return tree.children[0] as Tag;
}

function validationMessages(src: string): string[] {
  return Markdoc.validate(Markdoc.parse(src), markdocConfig).map((entry) => entry.error.message);
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

## A named treatment survives on a block quote

The renderer receives the closed treatment name. Omitting it remains distinct
from explicitly requesting `plain`, allowing the active card theme to supply
its own default.

```ts
const layered = blockQuoteTag('{% quote from="A participant" treatment="layered" %}\nKeep the example close.\n{% /quote %}');
`${layered.name}:${layered.attributes["treatment"]}:${layered.attributes["from"]}`
=>
QuoteBlock:layered:A participant

String(blockQuoteTag("{% quote %}\nTheme default.\n{% /quote %}").attributes["treatment"])
=>
undefined
```

## Treatment names are validated

```ts
validationMessages('{% quote treatment="floating" %}\nNo such treatment.\n{% /quote %}')
=>
[
  "Attribute 'treatment' must match one of [\"layered\",\"inset\",\"plain\"]. Got 'floating' instead."
]
```

## An inline quote stays inline and reports block-only treatment use

An explicit treatment never turns a quote inside a sentence into block markup.
The validation issue flows through the existing card-body warning pipeline.

```ts
const inlineLayered = quoteTag('Before {% quote treatment="layered" %}exact words{% /quote %} after.');
`${inlineLayered.name}:${inlineLayered.attributes["treatment"]}`
=>
QuoteInline:layered

validationMessages('Before {% quote treatment="layered" %}exact words{% /quote %} after.')
=>
[
  "Quote treatment 'layered' applies only to block quotes; this quote remains inline"
]

const [inlineWarning] = lintBodyMarkdoc('Before {% quote treatment="layered" %}exact words{% /quote %} after.');
`${inlineWarning?.severity}:${inlineWarning?.message}`
=>
warning:Markdoc body issue at line 1 (quote): Quote treatment 'layered' applies only to block quotes; this quote remains inline
```
